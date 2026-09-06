from dataclasses import dataclass, field

from anthropic import AsyncAnthropic
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.tools import READ_ONLY_TOOLS, TOOLS, run_tool

MODEL = "claude-sonnet-5"
MAX_TOOL_ROUNDS = 8

SYSTEM_PROMPT = """You are the built-in assistant inside Tifusi Panel, a proxy-management panel \
(FastAPI + React) modeled on PasarGuard. You can read and change everything in it through the \
tools you're given — cores, hosts, groups, nodes, users, REALITY/WireGuard keys, SNI scanning.

Domain model, exactly as this panel implements it (don't assume generic Xray-panel behavior — \
this one is specific):
- Core: one row holding a full, real Xray JSON config (config.inbounds is the actual Xray \
  inbound array — protocol, port, streamSettings, security, REALITY keys, everything). The panel \
  parses that JSON into Inbound rows automatically after you create/update a Core.
- Inbound: derived from a Core's JSON, identified by its unique `tag`. Never edited directly — \
  to change one, edit the Core's config and save it again.
- Host: what a client actually connects to. For vless/vmess/trojan/shadowsocks it just points at \
  an inbound_id and may override a handful of client-facing fields (sni/fingerprint/alpn/path/\
  security/allowinsecure) — protocol/network/REALITY keys/flow always come from the Inbound, \
  never from the Host. wireguard/hysteria2 hosts are standalone and keep their own fields \
  directly (no Inbound).
- Group: an access grant. inbound_ids gives members access to every Host built on those \
  Inbounds; host_ids is only for standalone wireguard/hysteria2 hosts; user_ids are the members.
- Node: a real server running Xray, assigned one Core (or none), synced by pushing that Core's \
  JSON (with live user credentials injected) to the node agent.
- User: a proxy account with a data_limit/expire/status, in some set of Groups — that membership \
  is what determines which Hosts show up in their subscription link.

Hard rule this project's admin insists on everywhere: never invent a value the admin didn't ask \
for and didn't leave implicit — no default fingerprint, no default SNI, no default port. If a \
required field is genuinely ambiguous, ask instead of guessing. It's fine to make an explicit, \
reasonable technical choice when the admin's request logically implies it (e.g. they asked for \
REALITY and gave no keys — generate a keypair) but always say what you picked and why.

When building a Core's config JSON from a description (e.g. "vless with reality on port 443, \
sni play.google.com"), write a complete, correct, real Xray inbound object — you know the actual \
Xray schema. Use generate_reality_keypair / generate_wireguard_keypair tools for key material \
instead of making up random-looking strings yourself.

Be concise. Confirm what you actually did (which tools ran, what changed) rather than repeating \
the whole JSON back unless asked. Reply in the same language the admin is writing in — plain \
Persian if they write Persian, English if they write English."""


@dataclass
class ChatResult:
    reply: str
    actions: list[str] = field(default_factory=list)


def _friendly_action(name: str, tool_input: dict) -> str:
    label = name.replace("_", " ")
    hint = tool_input.get("name") or tool_input.get("remark") or tool_input.get("username")
    ident = tool_input.get("core_id") or tool_input.get("host_id") or tool_input.get("group_id") or tool_input.get(
        "node_id"
    ) or tool_input.get("user_id")
    suffix = f" ({hint})" if hint else (f" (#{ident})" if ident else "")
    return f"{label}{suffix}"


async def run_chat(messages: list[dict], api_key: str, db: AsyncSession) -> ChatResult:
    client = AsyncAnthropic(api_key=api_key)
    conversation = list(messages)
    actions: list[str] = []

    for _ in range(MAX_TOOL_ROUNDS):
        response = await client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=conversation,
        )

        tool_uses = [block for block in response.content if block.type == "tool_use"]
        if not tool_uses:
            text = "".join(block.text for block in response.content if block.type == "text")
            return ChatResult(reply=text, actions=actions)

        conversation.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in tool_uses:
            if block.name not in READ_ONLY_TOOLS:
                actions.append(_friendly_action(block.name, block.input))
            result_text = await run_tool(block.name, block.input, db)
            tool_results.append(
                {"type": "tool_result", "tool_use_id": block.id, "content": result_text}
            )
        conversation.append({"role": "user", "content": tool_results})

    return ChatResult(
        reply="این کار چند مرحله‌ی زیادی طول کشید و متوقفش کردم — لطفاً درخواست رو ساده‌تر یا مرحله‌به‌مرحله بفرست.",
        actions=actions,
    )
