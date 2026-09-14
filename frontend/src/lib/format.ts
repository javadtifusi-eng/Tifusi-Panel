// Small display helpers shared by the dashboard shell and the overview.

// The backend stores UTC, but SQLite hands timestamps back without an
// offset; without one `new Date()` would read them as the viewer's local
// time and shift them by hours. Anything already carrying Z or ±hh:mm is
// left alone.
export function parseServerDate(iso: string): Date {
  return new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`)
}

// "mjozi" -> "MJ"; falls back to "?" for a name with no letters or digits.
export function initials(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9؀-ۿ]/g, '')
  return (letters.slice(0, 2) || '?').toUpperCase()
}

const AVATAR_COLORS = ['#c4b5fd', '#93c5fd', '#86efac', '#fcd34d', '#fda4af', '#a5b4fc', '#e5e5e5']

// A stable pastel per username, so the same user keeps the same avatar.
export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
