// The real Tifusi griffin mark (frontend/public/logo-tifusi.png), background
// keyed out to transparent. Not a redrawn approximation — the actual asset.
//
// Rendered as a CSS mask (background-color clipped to the PNG's alpha
// channel) rather than an <img> with a color filter: only the shape's
// alpha matters this way, so it always comes out in the exact color of
// the `--c-text-heading` token — near-white on the dark theme, near-black
// on light — guaranteed readable against `bg-surface`/`bg-app` in both,
// the same guarantee every other themed element gets from that token. An
// `invert()` filter on the raw image was tried here before and was only
// exactly correct if the source pixels were pure white/black; anything
// off that (anti-aliased edges, a non-pure-white fill) inverted to a
// dim, low-contrast grey instead of the crisp near-black light theme
// needs.
export function Logo({
  accent = '#f97316',
  size = 128,
  glow = true,
  color,
}: {
  accent?: string
  size?: number
  glow?: boolean
  /** Overrides the `--c-text-heading` token fill — for a fixed-brand
   * surface like the login page, which keeps one deliberate look
   * regardless of the light/dark toggle rather than following it. */
  color?: string
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size * 0.8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {glow && (
        <div
          style={{
            position: 'absolute',
            inset: '-30%',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${accent}59 0%, transparent 65%)`,
          }}
        />
      )}
      <div
        role="img"
        aria-label="Tifusi"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          backgroundColor: color ?? 'rgb(var(--c-text-heading))',
          WebkitMaskImage: 'url(/logo-tifusi.png)',
          maskImage: 'url(/logo-tifusi.png)',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    </div>
  )
}

type FeatureIconType = 'secure' | 'monitor' | 'perf' | 'crypto'

export function FeatureIcon({ type, accent = '#f97316' }: { type: FeatureIconType; accent?: string }) {
  const stroke = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: accent,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  switch (type) {
    case 'secure':
      return (
        <svg {...stroke}>
          <path d="M12 2 L4 5 V11 C4 16 7.5 20 12 22 C16.5 20 20 16 20 11 V5 Z" />
          <path d="M8.5 12 L11 14.5 L15.5 9.5" />
        </svg>
      )
    case 'monitor':
      return (
        <svg {...stroke}>
          <polyline points="2,12 7,12 9,6 13,18 15,12 22,12" />
        </svg>
      )
    case 'perf':
      return (
        <svg width={20} height={20} viewBox="0 0 24 24" fill={accent}>
          <path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z" />
        </svg>
      )
    case 'crypto':
      return (
        <svg {...stroke}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11 V7 a4 4 0 0 1 8 0 V11" />
        </svg>
      )
  }
}

// The Tifusi VPN launcher icon, copied from the app's adaptive icon
// (res/drawable/ic_launcher_foreground.xml on its #0A0F24 background). The
// panel's brand mark in the sidebar, on the sign-in screen and next to the
// app download link, so it matches what users see on their home screen.
export function TifusiMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 108 108" aria-hidden="true" className="flex-shrink-0">
      <rect width="108" height="108" rx="24" fill="#0A0F24" />
      <path
        d="M54,26 L77,34 L77,52 C77,67 67,78 54,84 C41,78 31,67 31,52 L31,34 Z"
        fill="none"
        stroke="#2979FF"
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <path d="M26,64 C40,50 70,43 84,47" fill="none" stroke="#29B6F6" strokeWidth={2} strokeLinecap="round" />
      <path d="M40,40 L68,40 L66,47 L58,47 L58,72 L50,72 L50,47 L40,47 Z" fill="#FFFFFF" />
    </svg>
  )
}
