"""Tool definitions + dispatcher for the in-panel AI assistant.

Every tool is a thin wrapper around the exact same functions the panel's own
routers call — created/edited/deleted objects go through the same
validation (app/routers/hosts.py::_validate, sync_inbounds' tag-collision
checks, etc.) an admin using the UI would hit. Nothing here bypasses that.
"""

import json
from typing import Any, Awaitable, Callable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.access import hosts_for_user
from app.links.generator import build_links_for_user, render_remark
from app.models.host import Host, HostProtocol
from app.reality.keys import generate_reality_keypair
from app.reality.scanner import is_reality_ready, scan_targets
from app.reality.targets import CANDIDATE_TARGETS
from app.schemas.core import CoreCreate, CoreUpdate
from app.schemas.group import GroupCreate, GroupUpdate
from app.schemas.host import HostCreate, HostUpdate
from app.schemas.node import NodeCreate, NodeUpdate
from app.schemas.user import ProxyUserCreate, ProxyUserUpdate
from app.settings_store import get_public_url
from app.wireguard.allocate import get_or_create_peer
from app.wireguard.config import build_client_config
from app.wireguard.keys import generate_wireguard_keypair

TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_cores",
        "description": "List every Core (a raw Xray JSON config) with its parsed Inbounds, host counts and node counts.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_core",
        "description": (
            "Create a new Core by pasting a real Xray config object (must contain an 'inbounds' array). "
            "Each inbound's tag/protocol/port/streamSettings/security(reality|tls|none)/REALITY keys all live "
            "inside this JSON, not on any Host. Build a complete, valid Xray inbound entry for whatever the "
            "admin asked for (protocol, transport, security) — do not invent unrequested settings silently; "
            "ask if something essential (like which port) wasn't specified."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Unique Core name."},
                "note": {"type": "string", "description": "Optional note."},
                "config": {"type": "object", "description": "A full Xray config object with an 'inbounds' array."},
            },
            "required": ["name", "config"],
        },
    },
    {
        "name": "update_core",
        "description": "Update a Core's name/note/config (full replacement of config, not a merge).",
        "input_schema": {
            "type": "object",
            "properties": {
                "core_id": {"type": "integer"},
                "name": {"type": "string"},
                "note": {"type": "string"},
                "config": {"type": "object"},
            },
            "required": ["core_id"],
        },
    },
    {
        "name": "delete_core",
        "description": "Delete a Core. Fails if any Host or Node still uses one of its Inbounds.",
        "input_schema": {"type": "object", "properties": {"core_id": {"type": "integer"}}, "required": ["core_id"]},
    },
    {
        "name": "list_hosts",
        "description": "List every Host (a client-facing address) with its protocol, overrides and effective (merged) values.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_host",
        "description": (
            "Create a Host. For vless/vmess/trojan/shadowsocks you must pass inbound_id (from list_cores' "
            "inbounds) — protocol/network/security/REALITY keys come from that Inbound's JSON automatically. "
            "Only pass an override field (sni_override, fingerprint_override, etc.) when the admin explicitly "
            "wants that value to differ from the Inbound's own — never fabricate one to fill a gap. "
            "For wireguard pass wireguard_public_key/private_key/subnet/port (use generate_wireguard_keypair "
            "for the keys). For hysteria2 pass hysteria2_sni/hysteria2_port."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "remark": {"type": "string"},
                "address": {"type": "string", "description": "The real server IP/domain clients connect to."},
                "protocol": {"type": "string", "enum": [p.value for p in HostProtocol]},
                "group_ids": {"type": "array", "items": {"type": "integer"}},
                "inbound_id": {"type": "integer"},
                "port_override": {"type": "integer"},
                "sni_override": {"type": "string"},
                "alpn_override": {"type": "string"},
                "fingerprint_override": {"type": "string"},
                "path_override": {"type": "string"},
                "host_header_override": {"type": "string"},
                "security_override": {"type": "string", "enum": ["none", "tls", "reality"]},
                "allowinsecure": {"type": "boolean"},
                "wireguard_public_key": {"type": "string"},
                "wireguard_private_key": {"type": "string"},
                "wireguard_subnet": {"type": "string"},
                "wireguard_port": {"type": "integer"},
                "hysteria2_sni": {"type": "string"},
                "hysteria2_port": {"type": "integer"},
            },
            "required": ["remark", "address", "protocol"],
        },
    },
    {
        "name": "update_host",
        "description": "Update a Host. Only pass fields that should change.",
        "input_schema": {
            "type": "object",
            "properties": {
                "host_id": {"type": "integer"},
                "remark": {"type": "string"},
                "address": {"type": "string"},
                "group_ids": {"type": "array", "items": {"type": "integer"}},
                "inbound_id": {"type": "integer"},
                "port_override": {"type": "integer"},
                "sni_override": {"type": "string"},
                "alpn_override": {"type": "string"},
                "fingerprint_override": {"type": "string"},
                "path_override": {"type": "string"},
                "host_header_override": {"type": "string"},
                "security_override": {"type": "string", "enum": ["none", "tls", "reality"]},
                "allowinsecure": {"type": "boolean"},
                "wireguard_public_key": {"type": "string"},
                "wireguard_private_key": {"type": "string"},
                "wireguard_subnet": {"type": "string"},
                "wireguard_port": {"type": "integer"},
                "hysteria2_sni": {"type": "string"},
                "hysteria2_port": {"type": "integer"},
            },
            "required": ["host_id"],
        },
    },
    {
        "name": "delete_host",
        "description": "Delete a Host.",
        "input_schema": {"type": "object", "properties": {"host_id": {"type": "integer"}}, "required": ["host_id"]},
    },
    {
        "name": "list_groups",
        "description": "List every Group (an access grant bundling Inbounds/standalone Hosts/Users).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_group",
        "description": (
            "Create a Group. inbound_ids grants access to xray-backed Hosts through those Inbounds; "
            "host_ids is only for standalone (wireguard/hysteria2) Hosts; user_ids are the members."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "note": {"type": "string"},
                "inbound_ids": {"type": "array", "items": {"type": "integer"}},
                "host_ids": {"type": "array", "items": {"type": "integer"}},
                "user_ids": {"type": "array", "items": {"type": "integer"}},
            },
            "required": ["name"],
        },
    },
    {
        "name": "update_group",
        "description": "Update a Group. Only pass fields that should change; list fields fully replace the previous set.",
        "input_schema": {
            "type": "object",
            "properties": {
                "group_id": {"type": "integer"},
                "name": {"type": "string"},
                "note": {"type": "string"},
                "inbound_ids": {"type": "array", "items": {"type": "integer"}},
                "host_ids": {"type": "array", "items": {"type": "integer"}},
                "user_ids": {"type": "array", "items": {"type": "integer"}},
            },
            "required": ["group_id"],
        },
    },
    {
        "name": "delete_group",
        "description": "Delete a Group.",
        "input_schema": {"type": "object", "properties": {"group_id": {"type": "integer"}}, "required": ["group_id"]},
    },
    {
        "name": "list_nodes",
        "description": "List every Node (a server actually running Xray) with its status/last error/assigned Core.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_node",
        "description": "Register a new Node. Returns an api_key the admin still has to install the node agent with.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "address": {"type": "string"},
                "port": {"type": "integer"},
                "core_id": {"type": "integer"},
            },
            "required": ["name", "address"],
        },
    },
    {
        "name": "update_node",
        "description": "Update a Node's name/address/port/assigned core.",
        "input_schema": {
            "type": "object",
            "properties": {
                "node_id": {"type": "integer"},
                "name": {"type": "string"},
                "address": {"type": "string"},
                "port": {"type": "integer"},
                "core_id": {"type": "integer"},
            },
            "required": ["node_id"],
        },
    },
    {
        "name": "delete_node",
        "description": "Delete a Node.",
        "input_schema": {"type": "object", "properties": {"node_id": {"type": "integer"}}, "required": ["node_id"]},
    },
    {
        "name": "sync_node",
        "description": "Push the assigned Core's config to a Node and report back its live status (connected/error).",
        "input_schema": {"type": "object", "properties": {"node_id": {"type": "integer"}}, "required": ["node_id"]},
    },
    {
        "name": "list_users",
        "description": "List proxy users (username, status, data limit/used traffic, expiry, groups).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "create_user",
        "description": "Create a proxy user.",
        "input_schema": {
            "type": "object",
            "properties": {
                "username": {"type": "string"},
                "data_limit": {"type": "integer", "description": "Bytes; omit for unlimited."},
                "expire": {"type": "string", "description": "ISO 8601 datetime; omit for no expiry."},
                "note": {"type": "string"},
                "group_ids": {"type": "array", "items": {"type": "integer"}},
            },
            "required": ["username"],
        },
    },
    {
        "name": "update_user",
        "description": "Update a proxy user's status/limit/expiry/note/groups.",
        "input_schema": {
            "type": "object",
            "properties": {
                "user_id": {"type": "integer"},
                "status": {"type": "string", "enum": ["active", "disabled", "expired", "limited"]},
                "data_limit": {"type": "integer"},
                "expire": {"type": "string"},
                "note": {"type": "string"},
                "group_ids": {"type": "array", "items": {"type": "integer"}},
            },
            "required": ["user_id"],
        },
    },
    {
        "name": "delete_user",
        "description": "Delete a proxy user.",
        "input_schema": {"type": "object", "properties": {"user_id": {"type": "integer"}}, "required": ["user_id"]},
    },
    {
        "name": "get_user_links",
        "description": "Get a user's subscription URL and every per-protocol connection link/config they're allowed to use.",
        "input_schema": {"type": "object", "properties": {"user_id": {"type": "integer"}}, "required": ["user_id"]},
    },
    {
        "name": "generate_reality_keypair",
        "description": "Generate a fresh X25519 REALITY private/public keypair plus a short_id, for use inside a Core's inbound JSON.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "generate_wireguard_keypair",
        "description": "Generate a fresh WireGuard private/public keypair.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "scan_reality_targets",
        "description": "Probe candidate SNI targets for REALITY (real TLS 1.3 + h2, reachable) and rank them by latency.",
        "input_schema": {"type": "object", "properties": {"sample_size": {"type": "integer"}}},
    },
]


def _err(exc: HTTPException) -> dict[str, Any]:
    return {"error": exc.detail, "status_code": exc.status_code}


def _only_present(input: dict, keys: list[str]) -> dict:
    """Builds kwargs from only the keys actually present in `input` — an
    *Update schema's fields default to None, so passing a key explicitly
    (even as None) marks it "set" and the router will overwrite the real
    value with None. Omitting absent keys keeps them untouched instead."""
    return {k: input[k] for k in keys if k in input}


async def _list_cores(input: dict, db: AsyncSession) -> Any:
    from app.routers.cores import list_cores

    result = await list_cores(db)
    return result.model_dump(mode="json")


async def _create_core(input: dict, db: AsyncSession) -> Any:
    from app.routers.cores import create_core

    payload = CoreCreate(name=input["name"], note=input.get("note"), config=input["config"])
    result = await create_core(payload, db)
    return result.model_dump(mode="json")


async def _update_core(input: dict, db: AsyncSession) -> Any:
    from app.routers.cores import update_core

    payload = CoreUpdate(**_only_present(input, ["name", "note", "config"]))
    result = await update_core(input["core_id"], payload, db)
    return result.model_dump(mode="json")


async def _delete_core(input: dict, db: AsyncSession) -> Any:
    from app.routers.cores import delete_core

    await delete_core(input["core_id"], db)
    return {"deleted": True}


async def _list_hosts(input: dict, db: AsyncSession) -> Any:
    from app.routers.hosts import list_hosts

    result = await list_hosts(db)
    return result.model_dump(mode="json")


def _host_payload_fields(input: dict) -> dict:
    fields = (
        "remark address protocol group_ids inbound_id port_override sni_override alpn_override "
        "fingerprint_override path_override host_header_override security_override allowinsecure "
        "wireguard_public_key wireguard_private_key wireguard_subnet wireguard_port "
        "hysteria2_sni hysteria2_port"
    ).split()
    return {k: input[k] for k in fields if k in input}


async def _create_host(input: dict, db: AsyncSession) -> Any:
    from app.routers.hosts import create_host
    from app.schemas.host import HostResponse

    payload = HostCreate(**_host_payload_fields(input))
    result = await create_host(payload, db)
    return HostResponse.model_validate(result).model_dump(mode="json")


async def _update_host(input: dict, db: AsyncSession) -> Any:
    from app.routers.hosts import update_host
    from app.schemas.host import HostResponse

    payload = HostUpdate(**_host_payload_fields(input))
    result = await update_host(input["host_id"], payload, db)
    return HostResponse.model_validate(result).model_dump(mode="json")


async def _delete_host(input: dict, db: AsyncSession) -> Any:
    from app.routers.hosts import delete_host

    await delete_host(input["host_id"], db)
    return {"deleted": True}


async def _list_groups(input: dict, db: AsyncSession) -> Any:
    from app.routers.groups import list_groups

    result = await list_groups(db)
    return result.model_dump(mode="json")


async def _create_group(input: dict, db: AsyncSession) -> Any:
    from app.routers.groups import create_group
    from app.schemas.group import GroupResponse

    payload = GroupCreate(
        name=input["name"],
        note=input.get("note"),
        inbound_ids=input.get("inbound_ids", []),
        host_ids=input.get("host_ids", []),
        user_ids=input.get("user_ids", []),
    )
    result = await create_group(payload, db)
    return GroupResponse.model_validate(result).model_dump(mode="json")


async def _update_group(input: dict, db: AsyncSession) -> Any:
    from app.routers.groups import update_group
    from app.schemas.group import GroupResponse

    payload = GroupUpdate(**_only_present(input, ["name", "note", "inbound_ids", "host_ids", "user_ids"]))
    result = await update_group(input["group_id"], payload, db)
    return GroupResponse.model_validate(result).model_dump(mode="json")


async def _delete_group(input: dict, db: AsyncSession) -> Any:
    from app.routers.groups import delete_group

    await delete_group(input["group_id"], db)
    return {"deleted": True}


async def _list_nodes(input: dict, db: AsyncSession) -> Any:
    from app.routers.nodes import list_nodes

    result = await list_nodes(db)
    return result.model_dump(mode="json")


async def _create_node(input: dict, db: AsyncSession) -> Any:
    from app.routers.nodes import create_node
    from app.schemas.node import NodeResponse

    payload = NodeCreate(
        name=input["name"], address=input["address"], port=input.get("port", 62050), core_id=input.get("core_id")
    )
    result = await create_node(payload, db)
    return NodeResponse.model_validate(result).model_dump(mode="json")


async def _update_node(input: dict, db: AsyncSession) -> Any:
    from app.routers.nodes import update_node
    from app.schemas.node import NodeResponse

    payload = NodeUpdate(**_only_present(input, ["name", "address", "port", "core_id"]))
    result = await update_node(input["node_id"], payload, db)
    return NodeResponse.model_validate(result).model_dump(mode="json")


async def _delete_node(input: dict, db: AsyncSession) -> Any:
    from app.routers.nodes import delete_node

    await delete_node(input["node_id"], db)
    return {"deleted": True}


async def _sync_node(input: dict, db: AsyncSession) -> Any:
    from app.routers.nodes import trigger_sync

    # sync_node() returns a plain dict, not a NodeSyncResult — that schema is
    # only applied by FastAPI's own response_model layer, which we bypass here.
    return await trigger_sync(input["node_id"], db)


async def _list_users(input: dict, db: AsyncSession) -> Any:
    from app.routers.users import list_users

    # offset/limit default to FastAPI Query() marker objects when this isn't
    # called through the framework's own DI — pass real ints explicitly.
    result = await list_users(offset=0, limit=200, db=db)
    return result.model_dump(mode="json")


async def _create_user(input: dict, db: AsyncSession) -> Any:
    from app.routers.users import create_user
    from app.schemas.user import ProxyUserResponse

    payload = ProxyUserCreate(
        username=input["username"],
        data_limit=input.get("data_limit"),
        expire=input.get("expire"),
        note=input.get("note"),
        group_ids=input.get("group_ids", []),
    )
    result = await create_user(payload, db)
    return ProxyUserResponse.model_validate(result).model_dump(mode="json")


async def _update_user(input: dict, db: AsyncSession) -> Any:
    from app.routers.users import update_user
    from app.schemas.user import ProxyUserResponse

    payload = ProxyUserUpdate(**_only_present(input, ["status", "data_limit", "expire", "note", "group_ids"]))
    result = await update_user(input["user_id"], payload, db)
    return ProxyUserResponse.model_validate(result).model_dump(mode="json")


async def _delete_user(input: dict, db: AsyncSession) -> Any:
    from app.routers.users import delete_user

    await delete_user(input["user_id"], db)
    return {"deleted": True}


async def _get_user_links(input: dict, db: AsyncSession) -> Any:
    from app.routers.users import _get_user_or_404

    user = await _get_user_or_404(input["user_id"], db)
    hosts = list((await db.execute(select(Host))).scalars().all())
    allowed_hosts = hosts_for_user(user, hosts)
    public_url = await get_public_url(db)
    if not public_url:
        return {
            "error": (
                "No public_url is configured in Settings, so a subscription URL can't be built here — "
                "ask the admin to set it, or just share the raw links below."
            ),
            "links": build_links_for_user(user, allowed_hosts),
        }
    base = public_url.rstrip("/") + "/"

    wireguard_configs = []
    for host in allowed_hosts:
        if host.protocol != HostProtocol.wireguard:
            continue
        try:
            peer = await get_or_create_peer(host, user, db)
        except ValueError as exc:
            return {"error": str(exc)}
        wireguard_configs.append({"remark": render_remark(host, user), "config": build_client_config(peer, host)})

    return {
        "subscription_url": f"{base}sub/{user.secret}",
        "links": build_links_for_user(user, allowed_hosts),
        "wireguard_configs": wireguard_configs,
    }


async def _generate_reality_keypair(input: dict, db: AsyncSession) -> Any:
    return generate_reality_keypair()


async def _generate_wireguard_keypair(input: dict, db: AsyncSession) -> Any:
    return generate_wireguard_keypair()


async def _scan_reality_targets(input: dict, db: AsyncSession) -> Any:
    hosts = CANDIDATE_TARGETS
    sample_size = input.get("sample_size")
    if sample_size:
        hosts = hosts[:sample_size]
    raw_results = await scan_targets(hosts)
    usable = [r for r in raw_results if is_reality_ready(r)]
    usable.sort(key=lambda r: r.latency_ms or float("inf"))
    best_host = usable[0].host if usable else None
    results = [
        {
            "host": r.host,
            "reachable": r.reachable,
            "tls_version": r.tls_version,
            "alpn": r.alpn,
            "latency_ms": r.latency_ms,
            "error": r.error,
            "recommended": r.host == best_host,
        }
        for r in raw_results
    ]
    return {"scanned": len(raw_results), "usable": len(usable), "results": results}


_HANDLERS: dict[str, Callable[[dict, AsyncSession], Awaitable[Any]]] = {
    "list_cores": _list_cores,
    "create_core": _create_core,
    "update_core": _update_core,
    "delete_core": _delete_core,
    "list_hosts": _list_hosts,
    "create_host": _create_host,
    "update_host": _update_host,
    "delete_host": _delete_host,
    "list_groups": _list_groups,
    "create_group": _create_group,
    "update_group": _update_group,
    "delete_group": _delete_group,
    "list_nodes": _list_nodes,
    "create_node": _create_node,
    "update_node": _update_node,
    "delete_node": _delete_node,
    "sync_node": _sync_node,
    "list_users": _list_users,
    "create_user": _create_user,
    "update_user": _update_user,
    "delete_user": _delete_user,
    "get_user_links": _get_user_links,
    "generate_reality_keypair": _generate_reality_keypair,
    "generate_wireguard_keypair": _generate_wireguard_keypair,
    "scan_reality_targets": _scan_reality_targets,
}

# Tools that only ever read — used to label the action log without a guess.
READ_ONLY_TOOLS = {
    "list_cores", "list_hosts", "list_groups", "list_nodes", "list_users",
    "get_user_links", "scan_reality_targets",
}


async def run_tool(name: str, input: dict, db: AsyncSession) -> str:
    handler = _HANDLERS.get(name)
    if handler is None:
        return json.dumps({"error": f"Unknown tool '{name}'"})
    try:
        result = await handler(input, db)
    except HTTPException as exc:
        return json.dumps(_err(exc))
    return json.dumps(result, default=str)
