from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import rate_limit
from app.database import get_db
from app.dependencies import require_permission
from app.models.admin import Admin
from app.models.app_report import AppReport
from app.models.user import ProxyUser
from app.routers.users import _owned_query
from app.schemas.app_report import AppReportPayload, AppReportResponse, RecentAppReportResponse
from app.subscription.lookup import client_ip, user_by_subscription_or_404

# Deliberately not behind get_current_admin, same as app/routers/subscription.py:
# the Android app has no admin token, only the subscription link or app code
# it was set up with, and that is the credential here too.
router = APIRouter(tags=["app"])

# The admin side, unlike `router` above: the dashboard's activity feed.
# Same "users" permission as GET /api/users/{id}/app-reports, since it is
# the same data across users.
admin_router = APIRouter(
    prefix="/api/app-reports",
    tags=["app"],
    dependencies=[Depends(require_permission("users"))],
)

_MAX_BODY_BYTES = 64 * 1024
_KEEP_PER_USER = 500

# Every request counts, not just failures: this endpoint writes to the
# database on success, and a 404 here is someone walking app codes (the
# code lookup is a full-table scan, see app/subscription/lookup.py). 30 per
# 10 minutes is far above what one phone flushing its queue needs.
_RATE_LIMIT_REQUESTS = 30
_RATE_LIMIT_WINDOW_SECONDS = 600


async def _read_capped_body(request: Request) -> bytes:
    """Reads the body ourselves instead of declaring a Pydantic body param:
    FastAPI would buffer the whole upload before any of our code ran, so
    neither the size cap nor the rate limit could stop it from being read
    in full. Content-Length is checked first as a cheap early refusal, but
    the streamed count is what actually enforces the cap, since a chunked
    upload has no Content-Length at all."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > _MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Report too large")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > _MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Report too large")
    return bytes(body)


def _parse_payload(body: bytes) -> AppReportPayload:
    try:
        return AppReportPayload.model_validate_json(body)
    except ValidationError as exc:
        # Same 422 shape FastAPI produces for a declared body param, so the
        # app sees one consistent error format across the panel's endpoints.
        errors = [{**err, "loc": ("body", *err["loc"])} for err in exc.errors(include_url=False)]
        raise RequestValidationError(errors) from exc


@router.post("/app/report", status_code=204, response_class=Response)
async def post_app_report(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """Connection diagnostics from the Tifusi VPN Android app. Body:
    AppReportPayload (app/schemas/app_report.py) as JSON, at most 64 KB and
    50 reports. 204 on success; 404 if `subscription` doesn't resolve to a
    user; 413/422 for an oversized/invalid body; 429 when rate limited."""
    ip = client_ip(request)
    # Before reading the body, so a rate-limited caller costs us nothing.
    rate_limit.hit(f"{ip}:app-report", max_requests=_RATE_LIMIT_REQUESTS, window_seconds=_RATE_LIMIT_WINDOW_SECONDS)

    payload = _parse_payload(await _read_capped_body(request))
    user = await user_by_subscription_or_404(payload.subscription, db)

    # Oldest event first, so a higher id always means a later event within
    # a batch — the admin view sorts by (received_at, id) and every report
    # in one request shares the same received_at.
    received_at = datetime.now(timezone.utc)
    for item in sorted(payload.reports, key=lambda r: r.at):
        db.add(
            AppReport(
                user_id=user.id,
                received_at=received_at,
                client_ip=ip[:64],
                app_version=payload.app_version,
                android_sdk=payload.android_sdk,
                device=payload.device,
                reported_at=datetime.fromtimestamp(item.at / 1000, tz=timezone.utc),
                event=item.event,
                result=item.result,
                detail=item.detail,
                protocol=item.protocol,
                duration_ms=item.duration_ms,
                network=item.network,
                carrier=item.carrier,
                sim_carrier=item.sim_carrier,
            )
        )

    if payload.reports:
        await db.flush()
        # Prune by id rather than timestamp: ids only grow, while
        # received_at ties across a whole batch. Anything older than the
        # _KEEP_PER_USER-th newest row goes.
        cutoff_id = await db.scalar(
            select(AppReport.id)
            .where(AppReport.user_id == user.id)
            .order_by(AppReport.id.desc())
            .offset(_KEEP_PER_USER - 1)
            .limit(1)
        )
        if cutoff_id is not None:
            await db.execute(delete(AppReport).where(AppReport.user_id == user.id, AppReport.id < cutoff_id))
        await db.commit()

    return Response(status_code=204)


@admin_router.get("/recent", response_model=list[RecentAppReportResponse])
async def recent_app_reports(
    limit: int = Query(default=20, ge=1, le=100),
    admin: Admin = Depends(require_permission("users")),
    db: AsyncSession = Depends(get_db),
) -> list[RecentAppReportResponse]:
    """The newest app reports across users, each with its username, newest
    first (same ordering as the per-user list). The owner sees every user's
    reports; any other admin only those of users they created, exactly as
    _owned_query scopes the user list itself."""
    stmt = _owned_query(
        admin,
        select(AppReport, ProxyUser.username).join(ProxyUser, ProxyUser.id == AppReport.user_id),
    )
    rows = await db.execute(stmt.order_by(AppReport.received_at.desc(), AppReport.id.desc()).limit(limit))
    return [
        RecentAppReportResponse(
            **AppReportResponse.model_validate(report).model_dump(),
            user_id=report.user_id,
            username=username,
        )
        for report, username in rows.all()
    ]
