// navigator.clipboard is only available in a secure context (HTTPS or
// localhost) — a panel reached over plain HTTP (e.g. the install script's
// unwrapped :8080 port, before a domain/cert is set up) has it undefined,
// and writeText() can also reject on permission policies. Callers used to
// await it, swallow any failure in an empty catch, and still show
// "Copied!" regardless — so a failed copy looked identical to a real one,
// and the user's only clue something was wrong was an empty clipboard.
// This resolves true/false so the UI can tell the difference and fall
// back to a manual copy instead of lying about it.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path below
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}
