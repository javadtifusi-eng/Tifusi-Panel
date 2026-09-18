"""Connection success per operator, built from the reports the Tifusi VPN
app sends (app/routers/app_reports.py). Only app users report, so this is
a sample of the user base, not all of it — the dashboard says so."""

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_report import AppReport
from app.network_health.operators import BY_KEY, UNKNOWN, classify
from app.schemas.network_health import (
    HealthAlert,
    MatrixCell,
    NetworkHealthReport,
    OperatorHealth,
    ProtocolRow,
    SeriesLine,
)

_MAX_ROWS = 50_000
# Below this many attempts a rate says more about luck than the network.
_MIN_ATTEMPTS = 5
_SERIES_OPERATORS = 3
_DROP = 0.2
_SUB_ALERT_RATE = 0.5


@dataclass
class _Tally:
    attempts: int = 0
    successes: int = 0
    sub_attempts: int = 0
    sub_successes: int = 0
    recent_attempts: int = 0
    recent_successes: int = 0
    previous_attempts: int = 0
    previous_successes: int = 0
    recent_sub_attempts: int = 0
    recent_sub_successes: int = 0
    users: set[int] = field(default_factory=set)
    last_at: datetime | None = None


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _rate(successes: int, attempts: int) -> float | None:
    return successes / attempts if attempts else None


def _state(attempts: int, rate: float | None) -> str:
    if attempts < _MIN_ATTEMPTS or rate is None:
        return "unknown"
    if rate >= 0.9:
        return "good"
    if rate >= 0.75:
        return "warn"
    return "bad"


def _is_subscription(event: str, result: str) -> bool:
    return result == "ok" or "sub" in event.lower()


async def build_report(db: AsyncSession, hours: int) -> NetworkHealthReport:
    now = datetime.now(timezone.utc)
    bucket_minutes = 60 if hours <= 48 else 360
    bucket = timedelta(minutes=bucket_minutes)
    count = math.ceil(hours * 60 / bucket_minutes)
    floor_hours = bucket_minutes // 60
    end = now.replace(minute=0, second=0, microsecond=0, hour=now.hour - now.hour % floor_hours) + bucket
    start = end - bucket * count
    recent_cut = now - max(timedelta(hours=2), timedelta(hours=hours) / 12)

    rows = await db.execute(
        select(
            AppReport.user_id,
            AppReport.reported_at,
            AppReport.received_at,
            AppReport.client_ip,
            AppReport.event,
            AppReport.result,
            AppReport.protocol,
            AppReport.network,
            AppReport.carrier,
            AppReport.sim_carrier,
        )
        .where(AppReport.reported_at >= start, AppReport.received_at >= start)
        .order_by(AppReport.id.desc())
        .limit(_MAX_ROWS)
    )

    tallies: dict[str, _Tally] = {}
    series: dict[str, list[list[int]]] = {}
    matrix: dict[str, dict[str, list[int]]] = {}
    total = _Tally()
    ip_cache: dict[tuple, str] = {}

    for user_id, reported_at, received_at, ip, event, result, protocol, network, carrier, sim_carrier in rows.all():
        # The app queues reports while offline; its clock can also run
        # ahead, so an event is never placed after the panel received it.
        at = min(_utc(reported_at), _utc(received_at))
        cache_key = (ip, network, carrier, sim_carrier)
        op = ip_cache.get(cache_key)
        if op is None:
            op = ip_cache[cache_key] = classify(ip, network, carrier, sim_carrier)
        tally = tallies.setdefault(op, _Tally())
        tally.users.add(user_id)
        total.users.add(user_id)
        tally.last_at = max(tally.last_at, at) if tally.last_at else at
        recent = at >= recent_cut

        if _is_subscription(event, result):
            ok = result == "ok"
            tally.sub_attempts += 1
            tally.sub_successes += ok
            if recent:
                tally.recent_sub_attempts += 1
                tally.recent_sub_successes += ok
            continue

        ok = result == "connected"
        for t in (tally, total):
            t.attempts += 1
            t.successes += ok
        if recent:
            tally.recent_attempts += 1
            tally.recent_successes += ok
        else:
            tally.previous_attempts += 1
            tally.previous_successes += ok

        index = min(count - 1, max(0, int((at - start) / bucket)))
        line = series.setdefault(op, [[0, 0] for _ in range(count)])
        line[index][0] += 1
        line[index][1] += ok

        proto = (protocol or "unknown").lower()[:32]
        cell = matrix.setdefault(proto, {}).setdefault(op, [0, 0])
        cell[0] += 1
        cell[1] += ok

    def name(key: str) -> tuple[str, str]:
        op = BY_KEY.get(key)
        return (op.name_fa, op.name_en) if op else ("نامشخص", "Unknown")

    ordered = sorted(tallies, key=lambda k: (k == UNKNOWN, -tallies[k].attempts, -tallies[k].sub_attempts))
    operators = []
    alerts: list[HealthAlert] = []
    for key in ordered:
        t = tallies[key]
        rate = _rate(t.successes, t.attempts)
        recent_rate = _rate(t.recent_successes, t.recent_attempts)
        previous_rate = _rate(t.previous_successes, t.previous_attempts)
        fa, en = name(key)
        operators.append(
            OperatorHealth(
                key=key,
                name_fa=fa,
                name_en=en,
                attempts=t.attempts,
                successes=t.successes,
                rate=rate,
                users=len(t.users),
                sub_attempts=t.sub_attempts,
                sub_successes=t.sub_successes,
                recent_rate=recent_rate,
                previous_rate=previous_rate,
                state=_state(t.attempts, rate),
                last_at=t.last_at,
                trend=[(ok / n if n >= 2 else None) for n, ok in series.get(key, [])],
            )
        )
        if key == UNKNOWN:
            continue
        if (
            t.recent_attempts >= _MIN_ATTEMPTS
            and t.previous_attempts >= 2 * _MIN_ATTEMPTS
            and recent_rate is not None
            and previous_rate is not None
            and previous_rate - recent_rate >= _DROP
        ):
            alerts.append(
                HealthAlert(kind="drop", operator=key, recent_rate=recent_rate, previous_rate=previous_rate, attempts=t.recent_attempts)
            )
        sub_rate = _rate(t.recent_sub_successes, t.recent_sub_attempts)
        if t.recent_sub_attempts >= _MIN_ATTEMPTS and sub_rate is not None and sub_rate < _SUB_ALERT_RATE:
            alerts.append(
                HealthAlert(
                    kind="subscription",
                    operator=key,
                    recent_rate=sub_rate,
                    previous_rate=None,
                    attempts=t.recent_sub_attempts,
                )
            )

    top = [k for k in ordered if k != UNKNOWN and tallies[k].attempts > 0][:_SERIES_OPERATORS]
    lines = [
        SeriesLine(
            key=k,
            rates=[(s / a if a >= 2 else None) for a, s in series[k]],
            attempts=[a for a, _ in series[k]],
        )
        for k in top
    ]

    op_keys = [k for k in ordered if tallies[k].attempts > 0]
    protocols = [
        ProtocolRow(
            protocol=proto,
            attempts=sum(a for a, _ in cells.values()),
            cells=[MatrixCell(operator=k, attempts=cells[k][0], successes=cells[k][1]) for k in op_keys if k in cells],
        )
        for proto, cells in sorted(matrix.items(), key=lambda kv: -sum(a for a, _ in kv[1].values()))
    ]

    return NetworkHealthReport(
        hours=hours,
        generated_at=now,
        bucket_minutes=bucket_minutes,
        buckets=[start + bucket * i for i in range(count)],
        attempts=total.attempts,
        successes=total.successes,
        rate=_rate(total.successes, total.attempts),
        users=len(total.users),
        operators=operators,
        series=lines,
        protocols=protocols,
        alerts=sorted(alerts, key=lambda a: (a.kind != "subscription", a.recent_rate)),
    )
