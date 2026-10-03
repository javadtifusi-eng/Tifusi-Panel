"""An animated walkthrough of typing an IKEv2 or L2TP profile into Android's
own VPN settings, shown under each such card on the subscription page.

Android has nothing like the iPhone's one-tap .mobileconfig, so every Android
customer types these fields by hand — and the usual mistakes are picking the
wrong Type, putting the PSK in "L2TP secret", or leaving IPSec identifier
empty (newer Androids refuse to save without it). The phone in the animation
types this customer's own server/username/password into the same fields, in
the order Android lays them out, and the sheet under it lists each value with
its own copy button so it can be pasted field by field.

Kept as a separate <script> on the page: it is the only code there newer
than ES5-era browsers might choke on, and a syntax error in it must never
take the copy buttons down with it.
"""

import html

_ANDROID_SVG = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">'
    '<path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.87 3.23A11.4 11.4 0 0 0 12 8.15c-1.77 0-3.43.39-4.91 1'
    "L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 "
    '0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/></svg>'
)

_KEY_SVG = (
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.65 10A6 6 0 1 0 12.65 14H17v4h4v-4h2v-4'
    'H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>'
)
_BACK_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z"/></svg>'
_PLUS_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>'
_GEAR_SVG = (
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94a7.1 7.1 0 0 0 0-1.88l2.03-1.58-1.92-3.32'
    "-2.39.96a7 7 0 0 0-1.62-.94L14.88 3.6h-3.84l-.36 2.58c-.58.24-1.12.55-1.62.94l-2.39-.96-1.92 3.32 2.03 1.58a7.1 7.1 0 0 0 "
    "0 1.88l-2.03 1.58 1.92 3.32 2.39-.96c.5.39 1.04.7 1.62.94l.36 2.58h3.84l.36-2.58c.58-.24 1.12-.55 1.62-.94l2.39.96 "
    '1.92-3.32-2.03-1.58zM12.96 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>'
)
_WIFI_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21 0 7.5C3.3 4.9 7.5 3.3 12 3.3S20.7 4.9 24 7.5z"/></svg>'
_SIGNAL_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 22h20V2z"/></svg>'
_BATTERY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 4h-2V2h-4v2H8a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/></svg>'


def _a(value: str) -> str:
    return html.escape(value, quote=True)


# (Android's own field label, value to enter, how it is entered). "type" is
# typed visibly, "mask" is typed as dots, "pick" is a dropdown choice, and
# "skip" is a field this server doesn't use and must stay empty.
def _fields(kind: str, server: str, username: str, password: str, psk: str | None) -> list[tuple[str, str, str]]:
    if kind == "l2tp":
        return [
            ("Server address", server, "type"),
            ("L2TP secret", "", "skip"),
            ("IPSec identifier", "", "skip"),
            ("IPSec pre-shared key", psk or "", "mask"),
            ("Username", username, "type"),
            ("Password", password, "mask"),
        ]
    if kind == "ikev2-psk":
        return [
            ("Server address", server, "type"),
            ("IPSec identifier", username, "type"),
            ("IPSec pre-shared key", psk or "", "mask"),
        ]
    return [
        ("Server address", server, "type"),
        ("IPSec identifier", username, "type"),
        ("IPSec CA certificate", "(don't verify server)", "pick"),
        ("IPSec server certificate", "(received from server)", "pick"),
        ("Username", username, "type"),
        ("Password", password, "mask"),
    ]


_TYPE_NAME = {"l2tp": "L2TP/IPSec PSK", "ikev2": "IKEv2/IPSec MSCHAPv2", "ikev2-psk": "IKEv2/IPSec PSK"}
# What the Type dropdown shows before it is changed, so the animation always
# has a visible change to make, whichever type this card needs.
_TYPE_BEFORE = {"l2tp": "PPTP", "ikev2": "IKEv2/IPSec PSK", "ikev2-psk": "IKEv2/IPSec MSCHAPv2"}
_TYPE_MENU = ["PPTP", "L2TP/IPSec PSK", "L2TP/IPSec RSA", "IKEv2/IPSec MSCHAPv2", "IKEv2/IPSec PSK", "IKEv2/IPSec RSA"]


def _steps(kind: str) -> list[str]:
    type_name = _TYPE_NAME[kind]
    if kind == "l2tp":
        fill = (
            "سرور، <b>IPSec pre-shared key</b>، یوزرنیم و پسورد را از جدول پایین وارد کن. "
            "<b>L2TP secret</b> و <b>IPSec identifier</b> را خالی بگذار."
        )
        pick_note = (
            "<small>نوع L2TP در لیست نیست؟ اندروید ۱۲ به بعد آن را برداشته؛ "
            "از اتصال IKEv2 یا لینک‌های اپ استفاده کن.</small>"
        )
    elif kind == "ikev2-psk":
        fill = "سرور، <b>IPSec identifier</b> (همان یوزرنیم) و <b>IPSec pre-shared key</b> را از جدول پایین وارد کن."
        pick_note = ""
    else:
        fill = (
            "سرور، <b>IPSec identifier</b> (همان یوزرنیم)، یوزرنیم و پسورد را وارد کن. "
            "در <b>IPSec CA certificate</b> گزینه‌ی <b>(don't verify server)</b> را بزن."
        )
        pick_note = ""
    return [
        "<b>Settings</b> گوشی را باز کن و <b>Network &amp; internet</b> را بزن."
        "<small>سامسونگ: Connections</small>",
        "گزینه‌ی <b>VPN</b> را بزن.<small>سامسونگ: More connection settings ← VPN</small>",
        "دکمه‌ی <b>+</b> بالای صفحه را بزن.<small>سامسونگ: ⋮ ← Add VPN profile</small>",
        f"یک اسم بنویس و در <b>Type</b> گزینه‌ی <b>{type_name}</b> را انتخاب کن.{pick_note}",
        fill,
        "دکمه‌ی <b>Save</b> را بزن.",
        "روی پروفایل بزن و <b>Connect</b>. آیکون کلید 🔑 بالای صفحه یعنی وصل شدی.",
    ]


def android_guide_html(kind: str, *, server: str, username: str, password: str, psk: str | None = None) -> str:
    """kind is "l2tp", "ikev2" (EAP-MSCHAPv2) or "ikev2-psk"."""
    fields = _fields(kind, server, username, password, psk)
    type_name = _TYPE_NAME[kind]
    needs_login = kind != "ikev2-psk"

    form_rows = "".join(
        f'<div class="ag-f{" ag-skip" if mode == "skip" else ""}{" ag-pick" if mode == "pick" else ""}" '
        f'data-m="{mode}" data-v="{_a(value)}"><label>{_a(label)}</label><div class="ag-in">'
        f'{"(not used)" if mode == "skip" else ("(none)" if mode == "pick" else "")}</div></div>'
        for label, value, mode in fields
    )
    menu = "".join(
        f'<div class="ag-opt"{" data-pick" if name == type_name else ""}>{_a(name)}</div>' for name in _TYPE_MENU
    )
    login_rows = (
        f'<div class="ag-dl"><span>Username</span><b>{_a(username)}</b></div>'
        f'<div class="ag-dl"><span>Password</span><b>{"•" * min(len(password), 12)}</b></div>'
        if needs_login
        else ""
    )
    steps = "".join(
        f'<li data-s="{i}"><span class="ag-n">{i + 1}</span><p>{text}</p></li>' for i, text in enumerate(_steps(kind))
    )

    sheet_rows = [("Name", "Tifusi", None), ("Type", type_name, None)]
    sheet_rows += [(label, "" if mode == "skip" else value, "خالی بگذار") for label, value, mode in fields]
    sheet = "".join(
        f'<div class="ag-row"><span class="ag-k">{_a(label)}</span>'
        + (
            f'<span class="ag-hint">{note}</span>'
            if not value
            else f'<span class="ag-v">{_a(value)}</span>'
            + (
                f'<button class="copy-btn" data-copy="{_a(value)}">کپی</button>'
                if label not in ("Type", "IPSec CA certificate", "IPSec server certificate")
                else '<span class="ag-sel">انتخاب کن</span>'
            )
        )
        + "</div>"
        for label, value, note in sheet_rows
    )

    phone = f"""
      <div class="ag-phone" aria-hidden="true">
        <div class="ag-bar"><span>12:30</span><i class="ag-cam"></i><span class="ag-ics"><i class="ag-vpnkey">{_KEY_SVG}</i>{_SIGNAL_SVG}{_WIFI_SVG}{_BATTERY_SVG}</span></div>
        <div class="ag-screens">
          <section class="ag-scr" data-scr="settings">
            <div class="ag-big">Settings</div>
            <div class="ag-search">Search settings</div>
            <div class="ag-row2" data-t="net"><i class="ag-dot" style="--c:#8ab4f8">{_WIFI_SVG}</i><div><b>Network &amp; internet</b><small>Mobile, Wi‑Fi, hotspot</small></div></div>
            <div class="ag-row2"><i class="ag-dot" style="--c:#81c995"></i><div><b>Connected devices</b><small>Bluetooth, pairing</small></div></div>
            <div class="ag-row2"><i class="ag-dot" style="--c:#f6aea9"></i><div><b>Apps</b><small>Recent apps, default apps</small></div></div>
            <div class="ag-row2"><i class="ag-dot" style="--c:#fdd663"></i><div><b>Notifications</b><small>History, conversations</small></div></div>
            <div class="ag-row2"><i class="ag-dot" style="--c:#c58af9"></i><div><b>Battery</b><small>82%</small></div></div>
          </section>
          <section class="ag-scr" data-scr="network">
            <div class="ag-app"><i>{_BACK_SVG}</i><b>Network &amp; internet</b></div>
            <div class="ag-row2"><div><b>Internet</b><small>Tifusi‑WiFi</small></div></div>
            <div class="ag-row2"><div><b>Calls &amp; SMS</b><small>Irancell</small></div></div>
            <div class="ag-row2"><div><b>SIMs</b><small>Irancell</small></div></div>
            <div class="ag-row2"><div><b>Airplane mode</b></div><i class="ag-tg"></i></div>
            <div class="ag-row2"><div><b>Hotspot &amp; tethering</b><small>Off</small></div></div>
            <div class="ag-row2" data-t="vpn"><div><b>VPN</b><small>None</small></div></div>
            <div class="ag-row2"><div><b>Private DNS</b><small>Automatic</small></div></div>
          </section>
          <section class="ag-scr" data-scr="vpn">
            <div class="ag-app"><i>{_BACK_SVG}</i><b>VPN</b><i class="ag-plus" data-t="add">{_PLUS_SVG}</i></div>
            <div class="ag-empty">No VPNs added</div>
            <div class="ag-prof"><i class="ag-pk">{_KEY_SVG}</i><div><b>Tifusi</b><small class="ag-pst"></small></div><i class="ag-gear">{_GEAR_SVG}</i></div>
            <div class="ag-dlg"><div class="ag-card">
              <b>Connect to Tifusi</b>
              {login_rows}
              <div class="ag-chk"><i></i>Save account information</div>
              <div class="ag-btns"><span>Cancel</span><span data-t="connect">Connect</span></div>
            </div></div>
          </section>
          <section class="ag-scr" data-scr="edit">
            <div class="ag-app"><b>Edit VPN profile</b></div>
            <div class="ag-view"><div class="ag-form">
              <div class="ag-f" data-k="name" data-m="type" data-v="Tifusi"><label>Name</label><div class="ag-in"></div></div>
              <div class="ag-f ag-pick" data-k="type"><label>Type</label><div class="ag-in" data-v="{_a(type_name)}">{_a(_TYPE_BEFORE[kind])}</div>
                <div class="ag-menu">{menu}</div></div>
              <div class="ag-more">{form_rows}</div>
            </div></div>
            <div class="ag-btns ag-foot"><span>Cancel</span><span data-t="save">Save</span></div>
          </section>
        </div>
        <div class="ag-ok">Connected</div>
        <i class="ag-finger"></i>
      </div>"""

    return f"""
    <details class="and-help">
      <summary><span class="and-ic">{_ANDROID_SVG}</span>راهنمای تصویری اتصال دستی در اندروید <span class="chev">▼</span></summary>
      <div class="ag">
        <div class="ag-stage">{phone}</div>
        <div class="ag-ctrl">
          <button type="button" class="ag-play" aria-label="توقف">❚❚</button>
          <div class="ag-prog"><i></i></div>
          <button type="button" class="ag-again">از اول ↺</button>
        </div>
        <ol class="ag-steps">{steps}</ol>
        <div class="ag-sheet">
          <div class="ag-sheet-t">مقادیری که باید وارد کنی</div>
          {sheet}
        </div>
      </div>
    </details>"""


ANDROID_GUIDE_CSS = """
  .and-help { margin-top: 8px; }
  .and-help summary {
    list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px;
    border: 1px solid rgba(61,220,132,0.28); color: #3ddc84; background: rgba(61,220,132,0.06);
    border-radius: 10px; padding: 8px 12px; font-size: 12.5px; font-weight: 600; user-select: none;
  }
  .and-help summary::-webkit-details-marker { display: none; }
  .and-help .and-ic { display: inline-flex; }
  .and-help summary .chev { font-size: 11px; transition: transform .2s; }
  .and-help[open] summary { border-bottom-left-radius: 0; border-bottom-right-radius: 0; background: rgba(61,220,132,0.1); }
  .and-help[open] summary .chev { transform: rotate(180deg); }
  .ag {
    border: 1px solid rgba(61,220,132,0.28); border-top: none; border-radius: 0 0 12px 12px; padding: 16px 12px 12px;
    background: radial-gradient(120% 70% at 50% 0%, rgba(61,220,132,0.12), transparent 60%), #0d110f;
  }
  .ag-stage { display: flex; justify-content: center; padding: 4px 0 10px; }
  .ag-phone {
    position: relative; width: 236px; height: 470px; border-radius: 34px; padding: 9px; direction: ltr;
    background: linear-gradient(145deg, #2a2d33, #121418); flex: none;
    box-shadow: 0 0 0 1px #3a3e45, 0 24px 48px -16px rgba(0,0,0,.8), 0 0 60px -20px rgba(61,220,132,.35);
    font-family: Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif; color: #e3e3e3; text-align: left;
    transition: box-shadow .6s;
  }
  .ag-phone.ag-on { box-shadow: 0 0 0 1px #3ddc84, 0 24px 48px -16px rgba(0,0,0,.8), 0 0 70px -10px rgba(61,220,132,.7); }
  .ag-bar {
    position: absolute; z-index: 3; top: 9px; left: 9px; right: 9px; height: 26px; padding: 0 16px;
    display: flex; align-items: center; justify-content: space-between; font-size: 10.5px; color: #e3e3e3;
    border-radius: 26px 26px 0 0;
  }
  .ag-cam { position: absolute; left: 50%; top: 8px; width: 9px; height: 9px; margin-left: -4.5px; border-radius: 50%; background: #050505; box-shadow: 0 0 0 1.5px #1b1d22; }
  .ag-ics { display: flex; align-items: center; gap: 3px; }
  .ag-ics svg { width: 11px; height: 11px; display: block; }
  .ag-vpnkey { display: inline-flex; width: 0; overflow: hidden; color: #3ddc84; transition: width .4s; }
  .ag-on .ag-vpnkey { width: 13px; }
  .ag-screens { position: absolute; inset: 9px; border-radius: 26px; overflow: hidden; background: #0f1115; }
  .ag-scr {
    position: absolute; inset: 0; padding: 30px 0 0; background: #0f1115; opacity: 0;
    transform: translateX(30%); transition: transform .42s cubic-bezier(.2,.8,.2,1), opacity .3s; pointer-events: none;
  }
  .ag-scr.ag-cur { opacity: 1; transform: none; z-index: 2; }
  .ag-scr.ag-prev { opacity: 0; transform: translateX(-18%); }
  .ag-big { font-size: 25px; padding: 22px 18px 12px; font-weight: 400; }
  .ag-search { margin: 0 12px 10px; padding: 9px 14px; border-radius: 22px; background: #1d2026; color: #9aa0a6; font-size: 11px; }
  .ag-row2 { display: flex; align-items: center; gap: 12px; padding: 9px 18px; font-size: 12px; transition: background .2s; }
  .ag-row2 b { display: block; font-weight: 500; color: #e3e3e3; }
  .ag-row2 small { display: block; color: #9aa0a6; font-size: 10px; margin-top: 1px; }
  .ag-row2 > div { flex: 1; min-width: 0; }
  .ag-dot { width: 26px; height: 26px; border-radius: 50%; flex: none; background: var(--c); opacity: .9; display: grid; place-items: center; color: #0f1115; }
  .ag-dot svg { width: 13px; height: 13px; }
  .ag-tg { width: 26px; height: 14px; border-radius: 8px; background: #3c4043; flex: none; }
  .ag-app { display: flex; align-items: center; gap: 12px; padding: 12px 14px 14px; font-size: 14px; }
  .ag-app b { font-weight: 400; flex: 1; }
  .ag-app i { display: inline-flex; width: 20px; height: 20px; color: #e3e3e3; }
  .ag-app svg { width: 20px; height: 20px; }
  .ag-plus { border-radius: 50%; }
  .ag-empty { text-align: center; color: #9aa0a6; font-size: 11px; padding-top: 70px; transition: opacity .3s; }
  .ag-prof {
    position: absolute; left: 0; right: 0; top: 76px; display: flex; align-items: center; gap: 12px; padding: 10px 18px;
    font-size: 12.5px; opacity: 0; transform: translateY(-6px); transition: opacity .35s, transform .35s, background .2s;
  }
  .ag-prof b { display: block; font-weight: 500; }
  .ag-prof small { display: block; font-size: 10px; color: #9aa0a6; min-height: 13px; }
  .ag-prof > div { flex: 1; }
  .ag-pk, .ag-gear { display: inline-flex; width: 20px; height: 20px; color: #9aa0a6; }
  .ag-pk svg, .ag-gear svg { width: 20px; height: 20px; }
  .ag-has .ag-prof { opacity: 1; transform: none; }
  .ag-has .ag-empty { opacity: 0; }
  .ag-on .ag-pk { color: #3ddc84; }
  .ag-on .ag-pst { color: #3ddc84; }
  .ag-dlg {
    position: absolute; inset: 0; z-index: 4; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; transition: opacity .25s;
  }
  .ag-dlg.ag-open { opacity: 1; }
  .ag-card { width: 82%; background: #262a31; border-radius: 22px; padding: 18px 16px 10px; font-size: 11px; transform: scale(.92); transition: transform .3s cubic-bezier(.2,.9,.3,1.3); }
  .ag-dlg.ag-open .ag-card { transform: none; }
  .ag-card > b { display: block; font-size: 14px; font-weight: 400; margin-bottom: 12px; }
  .ag-dl { border: 1px solid #5f6368; border-radius: 6px; padding: 6px 8px 5px; margin-bottom: 8px; position: relative; }
  .ag-dl span { position: absolute; top: -7px; left: 7px; background: #262a31; padding: 0 3px; font-size: 8.5px; color: #9aa0a6; }
  .ag-dl b { font-weight: 400; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ag-chk { display: flex; align-items: center; gap: 7px; color: #c4c7c5; font-size: 10px; margin: 2px 0 6px; }
  .ag-chk i { width: 12px; height: 12px; border-radius: 3px; background: #8ab4f8; flex: none; }
  .ag-btns { display: flex; justify-content: flex-end; gap: 4px; }
  .ag-btns span { color: #8ab4f8; font-size: 11.5px; font-weight: 500; padding: 7px 10px; border-radius: 16px; transition: background .2s; }
  .ag-foot { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px 12px 14px; background: #0f1115; border-top: 1px solid #1d2026; }
  .ag-view {
    position: absolute; top: 62px; left: 0; right: 0; bottom: 50px; overflow: hidden;
    -webkit-mask-image: linear-gradient(transparent, #000 12px); mask-image: linear-gradient(transparent, #000 12px);
  }
  .ag-form { position: relative; padding: 14px 14px 30px; transition: transform .38s cubic-bezier(.2,.8,.2,1); }
  .ag-f { position: relative; margin-bottom: 14px; }
  .ag-f label { position: absolute; top: -6px; left: 8px; z-index: 1; background: #0f1115; padding: 0 4px; font-size: 8.5px; color: #9aa0a6; transition: color .2s; }
  .ag-in {
    border: 1px solid #5f6368; border-radius: 6px; padding: 9px 10px 8px; font-size: 11.5px; min-height: 33px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: border-color .2s, box-shadow .2s;
  }
  .ag-pick .ag-in::after { content: "▾"; float: right; color: #9aa0a6; }
  .ag-skip .ag-in { color: #5f6368; font-style: italic; }
  .ag-focus label { color: #8ab4f8; }
  .ag-focus .ag-in { border-color: #8ab4f8; box-shadow: inset 0 0 0 1px #8ab4f8; }
  .ag-typing .ag-in::after { content: ""; display: inline-block; width: 1.5px; height: 12px; margin-left: 1px; vertical-align: -2px; background: #8ab4f8; animation: ag-caret .8s steps(1) infinite; }
  .ag-skip.ag-focus label { color: #f0b866; }
  .ag-skip.ag-focus .ag-in { border-color: #f0b866; box-shadow: inset 0 0 0 1px #f0b866; }
  @keyframes ag-caret { 50% { opacity: 0; } }
  .ag-more { max-height: 0; opacity: 0; overflow: hidden; transition: max-height .6s ease, opacity .4s; padding-top: 6px; margin-top: -6px; }
  .ag-more.ag-open { max-height: 520px; opacity: 1; }
  .ag-menu {
    position: absolute; z-index: 5; left: 0; right: 0; top: 36px; background: #262a31; border-radius: 6px; padding: 4px 0;
    box-shadow: 0 10px 24px rgba(0,0,0,.6); opacity: 0; transform: translateY(-6px) scaleY(.9); transform-origin: top;
    pointer-events: none; transition: opacity .2s, transform .25s;
  }
  .ag-menu.ag-open { opacity: 1; transform: none; }
  .ag-opt { padding: 7px 12px; font-size: 11px; transition: background .2s; }
  .ag-press { background: rgba(138,180,248,.16) !important; }
  .ag-ok {
    position: absolute; z-index: 6; left: 50%; bottom: 72px; transform: translate(-50%, 12px); opacity: 0;
    background: #3ddc84; color: #04210f; font-size: 11.5px; font-weight: 700; padding: 6px 16px; border-radius: 999px;
    box-shadow: 0 6px 20px rgba(61,220,132,.5); transition: opacity .35s, transform .35s;
  }
  .ag-ok::before { content: "✓ "; }
  .ag-on .ag-ok { opacity: 1; transform: translate(-50%, 0); }
  .ag-finger {
    position: absolute; z-index: 7; left: 0; top: 0; width: 30px; height: 30px; border-radius: 50%; pointer-events: none;
    background: rgba(255,255,255,.28); border: 2px solid rgba(255,255,255,.85); box-shadow: 0 4px 14px rgba(0,0,0,.5);
    transform: translate(103px, 400px); transition: transform .5s cubic-bezier(.4,0,.2,1), opacity .3s; opacity: 0;
  }
  .ag-finger.ag-show { opacity: 1; }
  .ag-finger.ag-tap { animation: ag-tap .32s ease; }
  .ag-finger::after {
    content: ""; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid #3ddc84; opacity: 0;
  }
  .ag-finger.ag-tap::after { animation: ag-ripple .5s ease-out; }
  @keyframes ag-tap { 50% { scale: .72; } }
  @keyframes ag-ripple { from { opacity: 1; transform: scale(.6); } to { opacity: 0; transform: scale(2.2); } }
  .ag-instant, .ag-instant * { transition: none !important; animation: none !important; }
  .ag-ctrl { display: flex; align-items: center; gap: 10px; margin: 2px 0 12px; }
  .ag-ctrl button {
    background: #16201a; color: #3ddc84; border: 1px solid rgba(61,220,132,.3); border-radius: 8px;
    padding: 5px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: inherit; flex: none;
  }
  .ag-play { width: 34px; }
  .ag-prog { flex: 1; height: 4px; border-radius: 4px; background: #1b231e; overflow: hidden; }
  .ag-prog i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #3ddc84, #8ab4f8); border-radius: 4px; transition: width .4s; }
  .ag-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .ag-steps li {
    display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: 10px; cursor: pointer;
    color: #8b8b8b; font-size: 12.5px; border: 1px solid transparent; transition: background .3s, color .3s, border-color .3s;
  }
  .ag-steps li p { margin: 0; }
  .ag-steps li b { color: inherit; direction: ltr; unicode-bidi: isolate; }
  .ag-steps li small { display: block; font-size: 11px; color: #6f7b74; margin-top: 2px; }
  .ag-n {
    flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700;
    background: #1b1f1d; color: #8b8b8b; transition: background .3s, color .3s;
  }
  .ag-steps li.ag-done .ag-n { background: rgba(61,220,132,.16); color: #3ddc84; }
  .ag-steps li.ag-cur { background: rgba(61,220,132,.08); border-color: rgba(61,220,132,.3); color: #e5e5e5; }
  .ag-steps li.ag-cur b { color: #f5f5f5; }
  .ag-steps li.ag-cur .ag-n { background: #3ddc84; color: #04210f; box-shadow: 0 0 0 4px rgba(61,220,132,.18); }
  .ag-sheet { margin-top: 12px; background: #111513; border: 1px solid #1f2a23; border-radius: 12px; padding: 10px 12px 4px; }
  .ag-sheet-t { font-size: 12px; color: #bebebe; margin-bottom: 4px; }
  .ag-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #1f2a23; font-size: 12px; direction: ltr; }
  .ag-row:last-child { border-bottom: none; }
  .ag-k { color: #8b8b8b; flex: none; width: 36%; font-size: 11px; line-height: 1.35; }
  .ag-v { flex: 1; min-width: 0; color: #f5f5f5; font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 11.5px; overflow-wrap: anywhere; }
  .ag-hint { flex: 1; color: #f0b866; font-size: 11.5px; direction: rtl; text-align: left; }
  .ag-sel { color: #6f7b74; font-size: 10.5px; flex: none; direction: rtl; }
"""


ANDROID_GUIDE_JS = r"""
(function () {
  function $(root, sel) { return root.querySelector(sel); }
  function $$(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  function Guide(root) {
    var g = this;
    g.root = root; g.box = $(root, '.ag'); g.phone = $(root, '.ag-phone'); g.finger = $(root, '.ag-finger');
    g.form = $(root, '.ag-form'); g.view = $(root, '.ag-view'); g.more = $(root, '.ag-more');
    g.steps = $$(root, '.ag-steps li'); g.prog = $(root, '.ag-prog i');
    g.playBtn = $(root, '.ag-play');
    g.gen = 0; g.paused = false; g.resume = null; g.cur = null;
    g.scenes = g.build();
    root.addEventListener('toggle', function () { root.open ? g.play(0) : g.stop(); });
    g.steps.forEach(function (li, i) { li.addEventListener('click', function () { g.paused = false; g.syncBtn(); g.play(i); }); });
    $(root, '.ag-again').addEventListener('click', function () { g.paused = false; g.syncBtn(); g.play(0); });
    g.playBtn.addEventListener('click', function () {
      g.paused = !g.paused; g.syncBtn();
      if (!g.paused && g.resume) { var r = g.resume; g.resume = null; r(); }
    });
  }

  Guide.prototype.syncBtn = function () {
    this.playBtn.textContent = this.paused ? '▶' : '❚❚';
    this.playBtn.setAttribute('aria-label', this.paused ? 'پخش' : 'توقف');
  };

  Guide.prototype.later = function (gen, fn, ms) {
    var g = this;
    setTimeout(function () { if (gen === g.gen) fn(); }, ms);
  };

  Guide.prototype.stop = function () { this.gen++; };

  Guide.prototype.reset = function () {
    var g = this, r = g.root;
    g.phone.classList.remove('ag-on');
    $$(r, '.ag-scr').forEach(function (s) { s.classList.remove('ag-cur', 'ag-prev', 'ag-has'); });
    $$(r, '.ag-f[data-v]').forEach(function (f) {
      var inp = $(f, '.ag-in');
      if (f.getAttribute('data-m') === 'type' || f.getAttribute('data-m') === 'mask') inp.textContent = '';
      if (f.getAttribute('data-m') === 'pick') inp.textContent = '(none)';
      f.classList.remove('ag-focus', 'ag-typing');
    });
    var typeIn = $(r, '[data-k="type"] .ag-in');
    typeIn.textContent = typeIn.getAttribute('data-before');
    g.more.classList.remove('ag-open');
    $(r, '.ag-menu').classList.remove('ag-open');
    $(r, '.ag-dlg').classList.remove('ag-open');
    $(r, '.ag-pst').textContent = '';
    g.form.style.transform = '';
    g.finger.classList.remove('ag-show', 'ag-tap');
    g.cur = null;
  };

  Guide.prototype.screen = function (name) {
    var g = this, next = $(g.root, '.ag-scr[data-scr="' + name + '"]');
    if (g.cur && g.cur !== next) { g.cur.classList.remove('ag-cur'); g.cur.classList.add('ag-prev'); }
    next.classList.remove('ag-prev'); next.classList.add('ag-cur');
    g.cur = next;
  };

  Guide.prototype.point = function (el) {
    var p = this.phone.getBoundingClientRect(), e = el.getBoundingClientRect();
    var x = e.left - p.left + Math.min(e.width / 2, 60) - 15, y = e.top - p.top + e.height / 2 - 15;
    this.finger.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    this.finger.classList.add('ag-show');
  };

  Guide.prototype.scrollTo = function (field) {
    var max = Math.max(0, this.form.scrollHeight - this.view.clientHeight);
    var y = Math.max(0, Math.min(max, field.offsetTop - this.view.clientHeight / 3));
    this.form.style.transform = 'translateY(' + (-y) + 'px)';
  };

  // Each action is fn(g, instant, done). Jumping to a step replays every
  // earlier action instantly, so any step can be started from a clean state.
  var A = {
    wait: function (ms) { return function (g, instant, done) { instant ? done() : g.later(g.gen, done, ms); }; },
    call: function (fn, ms) { return function (g, instant, done) { fn(g); instant ? done() : g.later(g.gen, done, ms || 0); }; },
    show: function (name) {
      return function (g, instant, done) { g.finger.classList.remove('ag-show'); g.screen(name); instant ? done() : g.later(g.gen, done, 480); };
    },
    tap: function (sel) {
      return function (g, instant, done) {
        if (instant) return done();
        var el = typeof sel === 'string' ? $(g.root, sel) : sel(g);
        var gen = g.gen;
        g.point(el);
        g.later(gen, function () {
          g.finger.classList.remove('ag-tap'); void g.finger.offsetWidth; g.finger.classList.add('ag-tap');
          el.classList.add('ag-press');
          g.later(gen, function () { el.classList.remove('ag-press'); done(); }, 340);
        }, 540);
      };
    },
    field: function (f) {
      return function (g, instant, done) {
        var mode = f.getAttribute('data-m'), val = f.getAttribute('data-v') || '', inp = $(f, '.ag-in');
        var show = function (n) { return mode === 'mask' ? new Array(Math.min(n, 14) + 1).join('•') : val.slice(0, n); };
        if (instant) {
          if (mode === 'type' || mode === 'mask') inp.textContent = show(val.length);
          if (mode === 'pick') inp.textContent = val;
          return done();
        }
        var gen = g.gen;
        g.scrollTo(f);
        g.later(gen, function () {
          A.tap(function () { return inp; })(g, false, function () {
            f.classList.add('ag-focus');
            if (mode === 'skip') return g.later(gen, function () { f.classList.remove('ag-focus'); done(); }, 900);
            if (mode === 'pick') {
              inp.textContent = val;
              return g.later(gen, function () { f.classList.remove('ag-focus'); done(); }, 700);
            }
            f.classList.add('ag-typing');
            var n = 0, speed = Math.max(28, Math.min(80, 1300 / Math.max(val.length, 1)));
            (function type() {
              if (gen !== g.gen) return;
              if (g.paused) { g.resume = type; return; }
              inp.textContent = show(++n);
              if (n < val.length) return setTimeout(type, speed);
              g.later(gen, function () { f.classList.remove('ag-focus', 'ag-typing'); done(); }, 380);
            })();
          });
        }, 400);
      };
    }
  };

  Guide.prototype.build = function () {
    var r = this.root;
    var typeIn = $(r, '[data-k="type"] .ag-in');
    typeIn.setAttribute('data-before', typeIn.textContent);
    var fields = $$(r, '.ag-more .ag-f').map(function (f) { return A.field(f); });
    return [
      [A.show('settings'), A.wait(600), A.tap('[data-t="net"]')],
      [A.show('network'), A.wait(450), A.tap('[data-t="vpn"]')],
      [A.show('vpn'), A.wait(550), A.tap('[data-t="add"]')],
      [
        A.show('edit'), A.field($(r, '[data-k="name"]')),
        A.tap('[data-k="type"] .ag-in'),
        A.call(function (g) { $(g.root, '.ag-menu').classList.add('ag-open'); }, 500),
        A.tap('.ag-opt[data-pick]'),
        A.call(function (g) {
          $(g.root, '.ag-menu').classList.remove('ag-open');
          typeIn.textContent = typeIn.getAttribute('data-v');
          g.more.classList.add('ag-open');
        }, 700)
      ],
      fields,
      [
        A.tap('[data-t="save"]'),
        A.show('vpn'),
        A.call(function (g) { g.form.style.transform = ''; g.cur.classList.add('ag-has'); }, 600)
      ],
      [
        A.tap('.ag-prof'),
        A.call(function (g) { $(g.root, '.ag-dlg').classList.add('ag-open'); }, 650),
        A.tap('[data-t="connect"]'),
        A.call(function (g) { $(g.root, '.ag-dlg').classList.remove('ag-open'); $(g.root, '.ag-pst').textContent = 'Connecting…'; }, 1300),
        A.call(function (g) { $(g.root, '.ag-pst').textContent = 'Connected'; g.phone.classList.add('ag-on'); g.finger.classList.remove('ag-show'); }, 2800)
      ]
    ];
  };

  Guide.prototype.mark = function (s, done, count) {
    this.steps.forEach(function (li, i) {
      li.classList.toggle('ag-cur', i === s);
      li.classList.toggle('ag-done', i < s);
    });
    this.prog.style.width = Math.round(done * 100 / count) + '%';
  };

  Guide.prototype.play = function (from) {
    var g = this, gen = ++g.gen, acts = [];
    g.resume = null;
    g.scenes.forEach(function (sc, s) { sc.forEach(function (a) { acts.push({ s: s, a: a }); }); });
    g.box.classList.add('ag-instant');
    g.reset();
    var i = 0;
    for (; i < acts.length && acts[i].s < from; i++) acts[i].a(g, true, function () {});
    void g.box.offsetWidth;
    g.box.classList.remove('ag-instant');
    (function step() {
      if (gen !== g.gen) return;
      if (g.paused) { g.resume = step; return; }
      if (i >= acts.length) {
        g.mark(g.scenes.length, acts.length, acts.length);
        return g.later(gen, function () { g.play(0); }, 1800);
      }
      var it = acts[i++];
      g.mark(it.s, i - 1, acts.length);
      it.a(g, false, step);
    })();
  };

  Array.prototype.forEach.call(document.querySelectorAll('.and-help'), function (el) {
    try { new Guide(el); } catch (e) {}
  });
})();
"""
