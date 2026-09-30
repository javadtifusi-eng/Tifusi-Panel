"""A real HTML page for a human opening a subscription link in a plain
browser — the same URL a VPN app fetches as a base64/YAML/JSON body
(app/routers/subscription.py's get_subscription). A browser opening that
URL directly showed raw base64 gibberish before this existed; routing
browsers here instead is the same "subscription info page" pattern most
proxy panels ship (Marzban, 3x-ui, ...), just branded for Tifusi.

Distinguishing "a human's browser" from "a VPN app's HTTP client" is done
by the caller via the Accept header (browsers send `text/html` first,
almost no VPN client does) — this module only renders, given data the
caller already built the same way the admin-facing /links endpoint does.
"""

import base64
import html
import io
from pathlib import Path

import qrcode
import qrcode.image.svg

_ACCENT = "#f97316"

_ASSETS = Path(__file__).resolve().parent / "assets"


def _data_uri(name: str) -> str:
    # Inlined rather than linked: the page is also reached on the panel's
    # own port, where nginx (and the dashboard's static files) isn't in front.
    return "data:image/png;base64," + base64.b64encode((_ASSETS / name).read_bytes()).decode()


_MARK_URI = _data_uri("tifusi-mark.png")

_APPLE_SVG = (
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">'
    '<path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 '
    "1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 "
    "1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 "
    "2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 "
    '1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>'
    "</svg>"
)

# A collapsed panel below the iPhone install button. iOS never auto-installs a downloaded
# profile — the user must open Settings and tap Install — and the most common failure is opening
# the link inside Telegram's in-app browser (which cannot install profiles at all). Kept behind a
# toggle so it does not clutter the page for anyone who already knows the two steps.
_IOS_HELP = (
    '<details class="ios-help">'
    '<summary>📱 راهنمای نصب روی آیفون <span class="chev">▼</span></summary>'
    '<div class="ios-guide">'
    '<div class="g-warn">⚠️ حتماً این صفحه را در <b>Safari</b> باز کن، نه مرورگر تلگرام.</div>'
    "<ol>"
    "<li>دکمه‌ی «نصب مستقیم» بالا را بزن.</li>"
    "<li>پیام «Profile Downloaded» می‌آید ← برو به <b>Settings</b>؛ بالای صفحه گزینه‌ی "
    "<b>Profile Downloaded</b> را بزن.</li>"
    "<li><b>Install</b> را بزن و رمز گوشی را وارد کن. تمام ✅</li>"
    "</ol>"
    "</div>"
    "</details>"
)


def _qr_svg(value: str) -> str:
    img = qrcode.make(value, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode()
    # Dark modules on the white .qr-box, never light-on-dark: the iPhone
    # camera and many scanner apps can't read an inverted code at all.
    svg = svg.replace("<svg ", '<svg style="width:176px;height:176px;display:block" ', 1)
    svg = svg.replace("<path ", '<path fill="#0b1120" ', 1)
    return svg


def _esc(value: str | None) -> str:
    return html.escape(value or "")


def _format_bytes(n: int) -> str:
    step = 1024.0
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < step:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} {unit}"
        value /= step
    return f"{value:.1f} PB"


def _traffic_line(used: int, limit: int | None) -> str:
    if limit is None:
        return f"{_format_bytes(used)} / بی‌نهایت"
    return f"{_format_bytes(used)} / {_format_bytes(limit)}"


def _used_percent(used: int, limit: int | None) -> int | None:
    if not limit:
        return None
    return max(0, min(100, round(used * 100 / limit)))


def _card(title: str, body_html: str, copy_value: str | None = None) -> str:
    copy_btn = f'<button class="copy-btn" data-copy="{_esc(copy_value)}">کپی</button>' if copy_value else ""
    return f"""
    <div class="card">
      <div class="card-head">
        <span class="badge">{_esc(title)}</span>
        {copy_btn}
      </div>
      {body_html}
    </div>"""


def build_info_page_html(
    *,
    username: str,
    status: str,
    used_traffic: int,
    data_limit: int | None,
    expire_text: str,
    subscription_url: str,
    links: list[str],
    ikev2_configs: list[dict],
    l2tp_configs: list[dict],
    pptp_configs: list[dict] | None = None,
    wireguard_conf: str | None = None,
    wireguard_conf_url: str | None = None,
) -> str:
    sections: list[str] = []

    if links:
        rows = "".join(
            f'<div class="link-row"><span class="mono">{_esc(link)}</span>'
            f'<button class="copy-btn" data-copy="{_esc(link)}">کپی</button></div>'
            for link in links
        )
        sections.append(
            f"""
        <div class="section">
          <div class="section-title">لینک‌های اتصال ({len(links)})</div>
          <div class="qr-wrap"><div class="qr-box">{_qr_svg(subscription_url)}</div></div>
          {rows}
        </div>"""
        )

    if wireguard_conf and wireguard_conf_url:
        # The official WireGuard app (the snake) scans this QR or opens the file.
        body = f"""
          <div class="qr-wrap"><div class="qr-box">{_qr_svg(wireguard_conf)}</div></div>
          <a class="mobileconfig-btn" href="{_esc(wireguard_conf_url)}"><span>دانلود فایل برای اپ WireGuard</span></a>
        """
        sections.append(_card("WireGuard", body))

    # IKEv2 and L2TP are set up in the phone's own VPN settings (Android,
    # Windows) or by the one-tap profile (iPhone), so each card lists exactly
    # the fields those settings ask for, starting with the type to pick.
    for ike in ikev2_configs:
        body = f"""
          <div class="kv"><span>نوع</span><span class="mono">IKEv2/IPSec MSCHAPv2</span></div>
          <div class="kv"><span>سرور</span><span class="mono">{_esc(ike['server'])}</span></div>
          <div class="kv"><span>یوزرنیم</span><span class="mono">{_esc(ike['username'])}</span></div>
          <div class="kv"><span>پسورد</span><span class="mono">{_esc(ike['password'])}</span></div>
          {f'<a class="mobileconfig-btn" href="{_esc(ike.get("install_url") or ike["mobileconfig_url"])}">{_APPLE_SVG}<span>نصب مستقیم روی آیفون و مک</span></a>{_IOS_HELP}' if ike.get('mobileconfig_url') else ''}
        """
        copy_text = f"Server: {ike['server']}\nUsername: {ike['username']}\nPassword: {ike['password']}"
        sections.append(_card(f"IKEv2 · {ike['remark']}", body, copy_text))

    for l2tp in l2tp_configs:
        body = f"""
          <div class="kv"><span>نوع</span><span class="mono">L2TP/IPSec PSK</span></div>
          <div class="kv"><span>سرور</span><span class="mono">{_esc(l2tp['server'])}</span></div>
          <div class="kv"><span>یوزرنیم</span><span class="mono">{_esc(l2tp['username'])}</span></div>
          <div class="kv"><span>پسورد</span><span class="mono">{_esc(l2tp['password'])}</span></div>
          {f'<div class="kv"><span>PSK</span><span class="mono">{_esc(l2tp["psk"])}</span></div>' if l2tp.get('psk') else ''}
          {f'<a class="mobileconfig-btn" href="{_esc(l2tp.get("install_url") or l2tp["mobileconfig_url"])}">{_APPLE_SVG}<span>نصب مستقیم روی آیفون و مک</span></a>{_IOS_HELP}' if l2tp.get('mobileconfig_url') else ''}
        """
        copy_text = f"Server: {l2tp['server']}\nUsername: {l2tp['username']}\nPassword: {l2tp['password']}"
        sections.append(_card(f"L2TP · {l2tp['remark']}", body, copy_text))

    # No QR and no install button: PPTP is only typed into an old phone's or
    # Windows' own VPN settings, and iOS has no PPTP to install a profile for.
    for pptp in pptp_configs or []:
        body = f"""
          <div class="kv"><span>نوع</span><span class="mono">PPTP</span></div>
          <div class="kv"><span>سرور</span><span class="mono">{_esc(pptp['server'])}</span></div>
          <div class="kv"><span>یوزرنیم</span><span class="mono">{_esc(pptp['username'])}</span></div>
          <div class="kv"><span>پسورد</span><span class="mono">{_esc(pptp['password'])}</span></div>
        """
        copy_text = f"Server: {pptp['server']}\nUsername: {pptp['username']}\nPassword: {pptp['password']}"
        sections.append(_card(f"PPTP · {pptp['remark']}", body, copy_text))

    if not sections:
        sections.append('<div class="empty">هیچ سرویسی برای این اکانت تعریف نشده.</div>')

    percent = _used_percent(used_traffic, data_limit)
    meter = (
        f'<div class="meter" role="img" aria-label="{percent}٪ مصرف شده"><i style="width:{percent}%"></i></div>'
        if percent is not None
        else ""
    )
    apple_url = next((c.get("install_url") or c["mobileconfig_url"] for c in ikev2_configs + l2tp_configs if c.get("mobileconfig_url")), None)
    apple_kind = "IKEv2" if any(c.get("mobileconfig_url") for c in ikev2_configs) else "L2TP"
    apple_tile = (
        f"""
        <a class="tile" href="{_esc(apple_url)}">
          <span class="tile-ic apple">{_APPLE_SVG}</span>
          <span class="tile-t"><b>آیفون، آیپد و مک</b><small>نصب پروفایل {apple_kind} با یک لمس</small></span>
          <span class="tile-go">نصب</span>
        </a>"""
        if apple_url
        else ""
    )

    return f"""<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a0a0a">
<title>Tifusi Panel</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 20px 16px 48px; background: #0a0a0a; color: #e5e5e5;
    font-family: 'Vazirmatn', Tahoma, system-ui, -apple-system, sans-serif; line-height: 1.6;
  }}
  .wrap {{ max-width: 560px; margin: 0 auto; }}
  .logo {{ display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 18px; }}
  .logo img {{ width: 74px; height: 40px; display: block; }}
  .logo b {{ font-size: 17px; font-weight: 700; color: #f5f5f5; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }}
  .logo small {{ font-size: 12px; color: #8b8b8b; }}
  .userbar {{ background: #141414; border: 1px solid #232323; border-radius: 16px; padding: 16px; margin-bottom: 16px; }}
  .userbar .top {{ display: flex; justify-content: space-between; align-items: center; gap: 10px; }}
  .userbar .name {{ font-weight: 700; color: #f5f5f5; font-size: 16px; direction: ltr; unicode-bidi: isolate; }}
  .userbar .meta {{ display: flex; justify-content: space-between; gap: 10px; color: #8b8b8b; font-size: 12px; margin-top: 10px; }}
  .userbar .meta b {{ color: #d4d4d4; font-weight: 500; direction: ltr; unicode-bidi: isolate; }}
  .meter {{ height: 6px; background: #0e0e0e; border-radius: 4px; overflow: hidden; margin-top: 8px; }}
  .meter i {{ display: block; height: 100%; background: {_ACCENT}; border-radius: 4px; }}
  .status {{ font-size: 12px; padding: 2px 12px; border-radius: 999px; border: 1px solid rgba(249,115,22,0.35); color: {_ACCENT}; background: rgba(249,115,22,0.08); white-space: nowrap; }}
  .section {{ margin-bottom: 16px; }}
  .section-title {{ font-size: 13px; color: #bebebe; margin-bottom: 8px; font-weight: 500; }}
  .tiles {{ display: flex; flex-direction: column; gap: 8px; }}
  .tile {{
    display: flex; align-items: center; gap: 12px; padding: 12px 14px; text-decoration: none; color: inherit;
    background: #141414; border: 1px solid #232323; border-radius: 14px;
  }}
  .tile:active {{ background: #1c1c1c; }}
  .tile-ic {{ width: 44px; height: 44px; border-radius: 11px; flex: none; display: grid; place-items: center; overflow: hidden; }}
  .tile-ic img {{ width: 44px; height: 44px; display: block; }}
  .tile-ic.apple {{ background: #f5f5f5; color: #0a0a0a; }}
  .tile-t {{ display: flex; flex-direction: column; flex: 1; min-width: 0; }}
  .tile-t b {{ font-size: 14px; color: #f5f5f5; font-weight: 600; }}
  .tile-t small {{ font-size: 12px; color: #8b8b8b; }}
  .tile-go {{ font-size: 12px; font-weight: 700; color: #1a0d02; background: {_ACCENT}; border-radius: 9px; padding: 6px 14px; flex: none; }}
  .code-row {{ display: flex; align-items: center; gap: 8px; margin-top: 8px; }}
  .code-row small {{ font-size: 12px; color: #8b8b8b; flex: 1; }}
  .qr-wrap {{ display: flex; justify-content: center; margin-bottom: 10px; }}
  .qr-box {{ background: #ffffff; padding: 12px; border-radius: 12px; line-height: 0; }}
  .link-row {{
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    background: #141414; border: 1px solid #232323; border-radius: 11px;
    padding: 8px 10px; margin-bottom: 6px;
  }}
  .link-row .mono {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; flex: 1; }}
  .card {{ background: #141414; border: 1px solid #232323; border-radius: 16px; padding: 14px 16px; margin-bottom: 12px; }}
  .card-head {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }}
  .badge {{ font-size: 12px; color: #bebebe; border: 1px solid #2a2a2a; border-radius: 999px; padding: 2px 10px; }}
  .kv {{ display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 5px 0; border-bottom: 1px dashed #232323; }}
  .kv:last-of-type {{ border-bottom: none; }}
  .kv span:first-child {{ color: #8b8b8b; }}
  .mono {{ font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; color: #f5f5f5; direction: ltr; unicode-bidi: isolate; font-size: 13px; }}
  .copy-btn {{
    background: #1c1c1c; color: #f5f5f5; border: 1px solid #2d2d2d; border-radius: 8px;
    padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0; font-family: inherit;
  }}
  .copy-btn.copied {{ background: #15221a; border-color: #22c55e; color: #22c55e; }}
  .mobileconfig-btn {{
    display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 10px; font-size: 13px; font-weight: 600;
    color: #0a0a0a; background: #f5f5f5; text-decoration: none; border-radius: 10px; padding: 9px 12px;
  }}
  .mobileconfig-btn svg {{ width: 18px; height: 18px; }}
  .ios-help {{ margin-top: 8px; }}
  .ios-help summary {{
    list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
    background: transparent; border: 1px solid #2d2d2d; color: #9aa4b2;
    border-radius: 10px; padding: 8px 12px; font-size: 12.5px; font-weight: 600; user-select: none;
  }}
  .ios-help summary::-webkit-details-marker {{ display: none; }}
  .ios-help summary .chev {{ font-size: 11px; transition: transform .2s; }}
  .ios-help[open] summary {{ color: #7cc4ff; border-color: #1f2b3a; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }}
  .ios-help[open] summary .chev {{ transform: rotate(180deg); }}
  .ios-guide {{
    background: #10151c; border: 1px solid #1f2b3a; border-top: none;
    border-radius: 0 0 10px 10px; padding: 11px 13px; font-size: 12.5px;
  }}
  .ios-guide .g-warn {{ color: #f0b866; margin-bottom: 8px; }}
  .ios-guide ol {{ margin: 0; padding-inline-start: 18px; display: grid; gap: 5px; color: #cbd5e1; }}
  .ios-guide b {{ color: #f5f5f5; }}
  .empty {{ text-align: center; color: #8b8b8b; font-size: 13px; padding: 20px 0; }}
  .reset-btn {{
    display: block; width: 100%; background: transparent; color: #f87171; border: 1px solid rgba(248,113,113,0.3);
    border-radius: 11px; padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
  }}
  .reset-btn.confirm {{ background: #3a1616; color: #fecaca; border-color: #f87171; }}
  .reset-btn:disabled {{ opacity: 0.6; cursor: default; }}
  .reset-hint {{ text-align: center; color: #6b6b6b; font-size: 11px; margin-top: 6px; }}
  .footer {{ display: flex; justify-content: center; margin-top: 28px; opacity: 0.35; }}
  .footer img {{ width: 44px; height: 24px; }}
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">
      <img src="{_MARK_URI}" width="74" height="40" alt="">
      <b>Tifusi Panel</b>
      <small>صفحه‌ی اطلاعات اشتراک</small>
    </div>

    <div class="userbar">
      <div class="top">
        <span class="name">{_esc(username)}</span>
        <span class="status">{_esc(status)}</span>
      </div>
      {meter}
      <div class="meta">
        <span>حجم: <b>{_esc(_traffic_line(used_traffic, data_limit))}</b></span>
        <span>انقضا: <b>{_esc(expire_text)}</b></span>
      </div>
    </div>

    {f'<div class="section"><div class="section-title">نصب روی آیفون</div><div class="tiles">{apple_tile}</div></div>' if apple_tile else ''}

    {"".join(sections)}

    <div class="section">
      <div class="section-title">لینک اشتراک کامل</div>
      <div class="link-row">
        <span class="mono" id="subUrlText">{_esc(subscription_url)}</span>
        <button class="copy-btn" data-copy="{_esc(subscription_url)}">کپی</button>
      </div>
    </div>

    <div class="section">
      <button class="reset-btn" id="resetBtn" type="button">بازنشانی کلید دسترسی</button>
      <div class="reset-hint">این کار همه‌ی لینک‌ها و رمزهای فعلیت رو باطل می‌کنه — باید تو همه‌ی دستگاه‌هات دوباره وصل بشی.</div>
    </div>

    <div class="footer"><img src="{_MARK_URI}" alt="Tifusi"></div>
  </div>

  <script>
    document.querySelectorAll('.copy-btn').forEach(function (btn) {{
      btn.addEventListener('click', function () {{
        var text = btn.getAttribute('data-copy');
        function done() {{
          var original = btn.textContent;
          btn.textContent = 'کپی شد';
          btn.classList.add('copied');
          setTimeout(function () {{ btn.textContent = original; btn.classList.remove('copied'); }}, 1200);
        }}
        if (navigator.clipboard && window.isSecureContext) {{
          navigator.clipboard.writeText(text).then(done).catch(function () {{ fallbackCopy(text, done); }});
        }} else {{
          fallbackCopy(text, done);
        }}
      }});
    }});
    function fallbackCopy(text, done) {{
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try {{ document.execCommand('copy'); done(); }} catch (e) {{}}
      document.body.removeChild(ta);
    }}

    var resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {{
      var confirming = false;
      var confirmTimer = null;
      var defaultLabel = resetBtn.textContent;
      resetBtn.addEventListener('click', function () {{
        if (!confirming) {{
          confirming = true;
          resetBtn.textContent = 'مطمئنی؟ همه دستگاه‌ها قطع می‌شن — دوباره بزن';
          resetBtn.classList.add('confirm');
          confirmTimer = setTimeout(function () {{
            confirming = false;
            resetBtn.textContent = defaultLabel;
            resetBtn.classList.remove('confirm');
          }}, 4000);
          return;
        }}
        clearTimeout(confirmTimer);
        resetBtn.disabled = true;
        resetBtn.textContent = 'در حال بازنشانی...';
        fetch(window.location.pathname + '/reset', {{ method: 'POST' }})
          .then(function (res) {{
            if (!res.ok) throw new Error('reset failed');
            var newSecret = res.headers.get('X-New-Secret');
            return res.text().then(function (body) {{ return {{ body: body, newSecret: newSecret }}; }});
          }})
          .then(function (r) {{
            if (r.newSecret) {{
              var parts = window.location.pathname.split('/');
              parts[parts.length - 1] = r.newSecret;
              history.replaceState(null, '', parts.join('/'));
            }}
            document.open();
            document.write(r.body);
            document.close();
          }})
          .catch(function () {{
            confirming = false;
            resetBtn.disabled = false;
            resetBtn.textContent = 'خطا — دوباره امتحان کن';
          }});
      }});
    }}
  </script>
</body>
</html>"""
