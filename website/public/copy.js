// Command boxes: a short label, an eye button that reveals the command, and a copy button.
// Guide code blocks are wrapped at load; the dashboard renders the same markup itself.
(function () {
  var fa = document.documentElement.lang === 'fa'
  var T = fa
    ? { cmd: 'دستور', copy: 'کپی', done: 'کپی شد', fail: 'خطا', show: 'نمایش دستور' }
    : { cmd: 'Command', copy: 'Copy', done: 'Copied', fail: 'Failed', show: 'Show command' }
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
  var OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  var CP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'

  function legacy(t) {
    var a = document.createElement('textarea')
    a.value = t; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;top:0;opacity:0'
    document.body.appendChild(a); a.select(); a.setSelectionRange(0, t.length)
    var ok = false
    try { ok = document.execCommand('copy') } catch (e) {}
    a.remove(); return ok
  }
  function copy(t) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(t).then(function () { return true }, function () { return legacy(t) })
    }
    return Promise.resolve(legacy(t))
  }

  function bar(label) {
    var b = document.createElement('div')
    b.className = 'tf-cbar'
    b.innerHTML = '<span class="tf-clbl"><i>$_</i><span></span></span>' +
      '<button type="button" class="tf-eye" aria-expanded="false" aria-label="' + T.show + '">' + EYE + '</button>' +
      '<button type="button" class="tf-cp" aria-label="' + T.copy + '">' + CP + '</button>'
    b.querySelector('.tf-clbl span').textContent = label
    return b
  }

  function wrapGuides() {
    document.querySelectorAll('.sl-markdown-content .expressive-code').forEach(function (ec) {
      var code = ec.querySelector('pre code')
      if (!code || ec.closest('.tf-cbox')) return
      var lines = Array.prototype.map.call(code.querySelectorAll('.ec-line'), function (l) { return l.textContent })
      var text = lines.length ? lines.join('\n') : code.textContent
      // A short lead-in like "Standard edition:" becomes the box label.
      var label = T.cmd, prev = ec.previousElementSibling
      if (prev && prev.tagName === 'P' && /[:：]\s*$/.test(prev.textContent) && prev.textContent.length < 70) {
        label = prev.textContent.replace(/[:：]\s*$/, '').trim(); prev.remove()
      }
      var box = document.createElement('div')
      box.className = 'tf-cbox not-content'
      box.dataset.cmd = text
      var full = document.createElement('div')
      full.className = 'tf-cfull'; full.hidden = true
      ec.replaceWith(box); full.appendChild(ec)
      box.appendChild(bar(label)); box.appendChild(full)
    })
  }

  document.addEventListener('click', function (e) {
    var eye = e.target.closest('.tf-eye'), cp = e.target.closest('.tf-cp')
    var box = (eye || cp) && (eye || cp).closest('.tf-cbox')
    if (!box) return
    if (eye) {
      var full = box.querySelector('.tf-cfull'), open = full.hidden
      full.hidden = !open; eye.setAttribute('aria-expanded', open)
    } else {
      var icon = cp.innerHTML
      copy(box.dataset.cmd || '').then(function (ok) {
        if (!ok) return
        cp.innerHTML = OK; cp.classList.add('ok'); cp.setAttribute('aria-label', T.done)
        setTimeout(function () { cp.innerHTML = icon; cp.classList.remove('ok'); cp.setAttribute('aria-label', T.copy) }, 1600)
      })
    }
  })

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrapGuides)
  else wrapGuides()
})()
