"""A tiny page between Telegram and an iPhone profile.

iOS installs a configuration profile only from Safari. Telegram opens a bot's
link buttons in its own in-app browser, where tapping a .mobileconfig does
nothing, so customers kept getting stuck there. This page sends them on:
in Safari it fetches the profile straight away; anywhere else on an iPhone it
hands the same address to Safari through the x-safari-https:// scheme
(iOS 17 and later), which leaves Telegram and continues the install in
Safari. Older iOS ignores that scheme, so the page also says how to open it
in Safari by hand and offers the link to copy.
"""
import json
from html import escape

_LABELS = {"ikev2": "IKEv2", "l2tp": "L2TP"}


def build_ios_install_html(kind: str, profile_path: str) -> str:
    """profile_path is relative to this page (it lives one level below the
    subscription), so the profile is fetched from whichever domain the
    customer opened the page on."""
    label = _LABELS.get(kind, kind)
    return f"""<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>نصب پروفایل {escape(label)}</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0b1120; color: #e5e7eb; font-family: -apple-system, Vazirmatn, Tahoma, sans-serif; }}
  .box {{ width: 100%; max-width: 380px; padding: 28px 20px; text-align: center; box-sizing: border-box; }}
  h1 {{ font-size: 19px; margin: 0 0 8px; }}
  p {{ color: #94a3b8; font-size: 14px; line-height: 1.9; margin: 0 0 18px; }}
  .btn {{ display: block; padding: 14px; border-radius: 12px; margin-bottom: 10px; font-size: 15px;
          font-weight: 700; text-decoration: none; border: 0; width: 100%; box-sizing: border-box; cursor: pointer; }}
  .main {{ background: #f97316; color: #fff; }}
  .alt {{ background: #1e293b; color: #e5e7eb; }}
  ol {{ text-align: right; color: #cbd5e1; font-size: 13.5px; line-height: 2; padding-inline-start: 20px; margin: 18px 0 0; }}
  #help[hidden] {{ display: none; }}
</style>
</head>
<body>
<div class="box">
  <h1>نصب پروفایل {escape(label)} روی آیفون</h1>
  <p id="msg">در حال رفتن به Safari…</p>
  <a class="btn main" id="safari" href="#">باز کردن در Safari</a>
  <button class="btn alt" id="copy" type="button">کپی لینک</button>
  <div id="help" hidden>
    <ol>
      <li>اگر Safari باز نشد: بالای صفحه روی <b>⋯</b> یا آیکن قطب‌نما بزن و <b>Open in Safari</b> را انتخاب کن.</li>
      <li>یا «کپی لینک» را بزن و لینک را در Safari باز کن.</li>
      <li>بعد از دانلود، برو به <b>Settings</b> ← <b>Profile Downloaded</b> ← <b>Install</b>.</li>
    </ol>
  </div>
</div>
<script>
  var file = new URL({json.dumps(profile_path)}, location.href).href;
  var safariUrl = "x-safari-" + file;
  var ua = navigator.userAgent;
  var iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Real Safari says "Safari/" and has navigator.standalone. Telegram's own
  // browser may copy Safari's user agent, but it injects TelegramWebviewProxy
  // and, being a plain web view, has no navigator.standalone; other iOS
  // browsers add their own name.
  var inSafari = /Safari\\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Telegram/i.test(ua)
    && typeof window.TelegramWebviewProxy === "undefined" && "standalone" in navigator;
  document.getElementById("safari").href = iOS && !inSafari ? safariUrl : file;
  document.getElementById("copy").onclick = function () {{
    var done = function () {{ document.getElementById("copy").textContent = "کپی شد ✅"; }};
    if (navigator.clipboard) navigator.clipboard.writeText(file).then(done, function () {{ prompt("", file); }});
    else prompt("", file);
  }};
  if (!iOS || inSafari) {{
    document.getElementById("msg").textContent = "دانلود پروفایل شروع شد؛ بعدش برو به Settings.";
    location.replace(file);
  }} else {{
    location.href = safariUrl;
  }}
  setTimeout(function () {{
    document.getElementById("msg").textContent = "اگر خودکار به Safari نرفت، دکمه‌ی زیر را بزن.";
    document.getElementById("help").hidden = false;
  }}, 1500);
</script>
</body>
</html>
"""
