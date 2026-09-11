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

import html
import io

import qrcode
import qrcode.image.svg

_ACCENT = "#22d3ee"


def _qr_svg(value: str) -> str:
    img = qrcode.make(value, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode()
    # The default fill is black on a transparent background — fine on the
    # white QR backdrop below, but the generated <svg> has no width/height
    # scaling for our fixed display box, so pin those explicitly.
    return svg.replace("<svg ", '<svg style="width:176px;height:176px" ', 1)


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


def _card(title: str, copy_value: str, body_html: str) -> str:
    return f"""
    <div class="card">
      <div class="card-head">
        <span class="badge">{_esc(title)}</span>
        <button class="copy-btn" data-copy="{_esc(copy_value)}">کپی</button>
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
) -> str:
    sections: list[str] = []

    if links:
        # QR/barcode import only makes sense for these URI-based links
        # (vless://, vmess://, ...) — ikev2/l2tp below have no such scheme,
        # a client can't "scan" its way into a username/password + PSK.
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

    for ike in ikev2_configs:
        body = f"""
          <div class="kv"><span>سرور</span><span class="mono">{_esc(ike['server'])}</span></div>
          <div class="kv"><span>یوزرنیم</span><span class="mono">{_esc(ike['username'])}</span></div>
          <div class="kv"><span>پسورد</span><span class="mono">{_esc(ike['password'])}</span></div>
          {f'<div class="kv"><span>PSK</span><span class="mono">{_esc(ike["psk"])}</span></div>' if ike.get('psk') else ''}
          {f'<a class="mobileconfig-btn" href="{_esc(ike["mobileconfig_url"])}">نصب مستقیم روی iOS/macOS</a>' if ike.get('mobileconfig_url') else ''}
        """
        copy_text = f"Server: {ike['server']}\nUsername: {ike['username']}\nPassword: {ike['password']}"
        sections.append(_card(f"IKEv2 · {ike['remark']}", copy_text, body))

    for l2tp in l2tp_configs:
        body = f"""
          <div class="kv"><span>سرور</span><span class="mono">{_esc(l2tp['server'])}</span></div>
          <div class="kv"><span>یوزرنیم</span><span class="mono">{_esc(l2tp['username'])}</span></div>
          <div class="kv"><span>پسورد</span><span class="mono">{_esc(l2tp['password'])}</span></div>
          {f'<div class="kv"><span>PSK</span><span class="mono">{_esc(l2tp["psk"])}</span></div>' if l2tp.get('psk') else ''}
        """
        copy_text = f"Server: {l2tp['server']}\nUsername: {l2tp['username']}\nPassword: {l2tp['password']}"
        sections.append(_card(f"L2TP · {l2tp['remark']}", copy_text, body))

    if not sections:
        sections.append('<div class="empty">هیچ سرویسی برای این اکانت تعریف نشده.</div>')

    return f"""<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tifusi Panel</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 24px 16px 48px; background: #0b1120; color: #e2e8f0;
    font-family: 'Vazirmatn', Tahoma, system-ui, -apple-system, sans-serif;
  }}
  .wrap {{ max-width: 640px; margin: 0 auto; }}
  .logo {{
    display: flex; align-items: center; justify-content: center; gap: 10px;
    margin-bottom: 4px;
  }}
  .logo-mark {{
    width: 34px; height: 34px; border-radius: 9px;
    background: linear-gradient(135deg, {_ACCENT}, #0891b2);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; color: #04212a; font-size: 16px;
  }}
  .logo-text {{ font-size: 20px; font-weight: 800; color: #f1f5f9; letter-spacing: 0.3px; }}
  .sub {{ text-align: center; color: #64748b; font-size: 12px; margin-bottom: 22px; }}
  .userbar {{
    display: flex; justify-content: space-between; align-items: center;
    background: #111827; border: 1px solid rgba(34,211,238,0.15); border-radius: 14px;
    padding: 14px 16px; margin-bottom: 18px; font-size: 13px;
  }}
  .userbar .name {{ font-weight: 700; color: #f1f5f9; }}
  .userbar .meta {{ color: #94a3b8; font-size: 11px; margin-top: 2px; }}
  .status {{ font-size: 11px; padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(34,211,238,0.3); color: {_ACCENT}; }}
  .section {{ margin-bottom: 18px; }}
  .section-title {{ font-size: 12px; color: #94a3b8; margin-bottom: 8px; }}
  .qr-wrap {{ display: flex; justify-content: center; margin-bottom: 10px; }}
  .qr-box {{ background: #fff; padding: 12px; border-radius: 12px; line-height: 0; }}
  .link-row {{
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    background: #111827; border: 1px solid #1e293b; border-radius: 10px;
    padding: 8px 10px; margin-bottom: 6px;
  }}
  .link-row .mono {{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: ltr; text-align: left; flex: 1; }}
  .card {{
    background: #111827; border: 1px solid #1e293b; border-radius: 14px;
    padding: 14px 16px; margin-bottom: 12px;
  }}
  .card-head {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }}
  .badge {{
    font-size: 11px; color: #94a3b8; border: 1px solid #334155; border-radius: 999px;
    padding: 3px 10px;
  }}
  .kv {{ display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; border-bottom: 1px dashed #1e293b; }}
  .kv:last-of-type {{ border-bottom: none; }}
  .kv span:first-child {{ color: #64748b; }}
  .mono {{ font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; color: {_ACCENT}; direction: ltr; }}
  .copy-btn {{
    background: {_ACCENT}; color: #04212a; border: none; border-radius: 8px;
    padding: 5px 12px; font-size: 11px; font-weight: 700; cursor: pointer;
    flex-shrink: 0;
  }}
  .copy-btn.copied {{ background: #4ade80; }}
  .mobileconfig-btn {{
    display: inline-block; margin-top: 8px; font-size: 11px; color: {_ACCENT};
    text-decoration: none; border: 1px solid rgba(34,211,238,0.3); border-radius: 8px;
    padding: 6px 12px;
  }}
  .empty {{ text-align: center; color: #64748b; font-size: 13px; padding: 20px 0; }}
  .reset-btn {{
    display: block; width: 100%; background: #1e293b; color: #f87171; border: 1px solid rgba(248,113,113,0.3);
    border-radius: 10px; padding: 10px 14px; font-size: 12px; font-weight: 700; cursor: pointer;
    font-family: inherit;
  }}
  .reset-btn.confirm {{ background: #7f1d1d; color: #fecaca; border-color: #f87171; }}
  .reset-btn:disabled {{ opacity: 0.6; cursor: default; }}
  .reset-hint {{ text-align: center; color: #64748b; font-size: 10px; margin-top: 6px; }}
  .footer {{ text-align: center; color: #334155; font-size: 10px; margin-top: 28px; }}
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">
      <div class="logo-mark">T</div>
      <div class="logo-text">Tifusi Panel</div>
    </div>
    <div class="sub">صفحه‌ی اطلاعات اشتراک</div>

    <div class="userbar">
      <div>
        <div class="name">{_esc(username)}</div>
        <div class="meta">{_esc(_traffic_line(used_traffic, data_limit))} · انقضا: {_esc(expire_text)}</div>
      </div>
      <div class="status">{_esc(status)}</div>
    </div>

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

    <div class="footer">Tifusi Panel</div>
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
