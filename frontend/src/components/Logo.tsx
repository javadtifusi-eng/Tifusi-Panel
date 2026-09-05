// The twin-head griffin/column mark below is Tifusi's real emblem — lifted
// from the brand's own logo-tifusi.svg (Tifusi Tunnel) and recolored to the
// panel's cyan accent, not a redrawn approximation.
export function Logo({ accent = '#22D3EE', size = 128 }: { accent?: string; size?: number }) {
  return (
    <svg viewBox="150 90 500 570" width={size} height={(size * 570) / 500}>
      <defs>
        <radialGradient id="tifusiGlow" cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
          <stop offset="100%" stopColor={accent} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={400} cy={330} r={260} fill="url(#tifusiGlow)" />
      <g fill="none" stroke={accent} strokeLinejoin="round" strokeLinecap="round">
        <g>
          <path
            d="M400,340 L420,300 L450,270 L478,255 L510,258 L548,255 L585,248 L588,238 L565,222 L540,195 L515,168 L495,152 L478,158 L455,180 L445,210 L430,245 L415,285 Z"
            strokeWidth={6}
          />
          <path d="M485,155 L500,120 L505,150" strokeWidth={5} />
          <circle cx={525} cy={195} r={5} fill={accent} stroke="none" />
          <path d="M494,168 L471,190 L461,220 L446,255 L431,295" strokeWidth={3.5} />
          <path d="M465,185 L478,170 M450,215 L465,202 M435,250 L450,238" strokeWidth={4} />
        </g>
        <g transform="translate(800,0) scale(-1,1)">
          <path
            d="M400,340 L420,300 L450,270 L478,255 L510,258 L548,255 L585,248 L588,238 L565,222 L540,195 L515,168 L495,152 L478,158 L455,180 L445,210 L430,245 L415,285 Z"
            strokeWidth={6}
          />
          <path d="M485,155 L500,120 L505,150" strokeWidth={5} />
          <circle cx={525} cy={195} r={5} fill={accent} stroke="none" />
          <path d="M494,168 L471,190 L461,220 L446,255 L431,295" strokeWidth={3.5} />
          <path d="M465,185 L478,170 M450,215 L465,202 M435,250 L450,238" strokeWidth={4} />
        </g>
        <path d="M400,320 L400,340" strokeWidth={6} />
        <path d="M330,338 L470,338 L446,390 L354,390 Z" strokeWidth={5} />
        <path d="M362,390 L438,390 L420,610 L380,610 Z" strokeWidth={5} />
        <path
          d="M377,391 L388,609 M392,391 L396,609 M408,391 L404,609 M423,391 L412,609"
          strokeWidth={2.5}
        />
        <path d="M366,610 L434,610 L440,636 L360,636 Z" strokeWidth={5} />
      </g>
    </svg>
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
