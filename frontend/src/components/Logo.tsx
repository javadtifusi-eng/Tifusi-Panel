// The real Tifusi griffin mark (frontend/public/logo-tifusi.png), background
// keyed out to transparent. Not a redrawn approximation — the actual asset.
export function Logo({ accent = '#22D3EE', size = 128 }: { accent?: string; size?: number }) {
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
      <div
        style={{
          position: 'absolute',
          inset: '-30%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}59 0%, transparent 65%)`,
        }}
      />
      <img
        src="/logo-tifusi.png"
        alt="Tifusi"
        style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}

type FeatureIconType = 'secure' | 'monitor' | 'perf' | 'crypto'

export function FeatureIcon({ type, accent = '#22D3EE' }: { type: FeatureIconType; accent?: string }) {
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
