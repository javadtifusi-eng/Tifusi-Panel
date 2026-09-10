/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic, theme-aware tokens — each backed by a CSS custom
        // property (see :root / [data-theme="light"] in index.css) so the
        // same class names resolve to dark-theme or light-theme colors
        // depending on the <html data-theme> attribute, instead of the
        // literal slate/white/black-opacity classes this replaced (those
        // only ever had one dark-theme meaning baked in).
        app: 'rgb(var(--c-app) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        field: 'rgb(var(--c-field) / <alpha-value>)',
        well: 'rgb(var(--c-well) / <alpha-value>)',
        'well-strong': 'rgb(var(--c-well-strong) / <alpha-value>)',

        hair: 'rgb(var(--c-border-hair) / <alpha-value>)',
        subtle: 'rgb(var(--c-border-subtle) / <alpha-value>)',
        edge: 'rgb(var(--c-border-default) / <alpha-value>)',
        strong: 'rgb(var(--c-border-strong) / <alpha-value>)',

        heading: 'rgb(var(--c-text-heading) / <alpha-value>)',
        primary: 'rgb(var(--c-text-primary) / <alpha-value>)',
        body: 'rgb(var(--c-text-body) / <alpha-value>)',
        secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
        muted: 'rgb(var(--c-text-muted) / <alpha-value>)',
        faint: 'rgb(var(--c-text-faint) / <alpha-value>)',

        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-tint': 'rgb(var(--c-accent-tint) / <alpha-value>)',

        success: 'rgb(var(--c-success) / <alpha-value>)',
        'success-tint': 'rgb(var(--c-success-tint) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        'danger-tint': 'rgb(var(--c-danger-tint) / <alpha-value>)',
        warning: 'rgb(var(--c-warning) / <alpha-value>)',
        'warning-tint': 'rgb(var(--c-warning-tint) / <alpha-value>)',
        neutral: 'rgb(var(--c-neutral) / <alpha-value>)',
        'neutral-tint': 'rgb(var(--c-neutral-tint) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Chakra Petch"', 'sans-serif'],
        body: ['"Vazirmatn"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.82)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'grow-x': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 0.7s cubic-bezier(0.34,1.56,0.64,1) both',
        'grow-x': 'grow-x 0.6s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
