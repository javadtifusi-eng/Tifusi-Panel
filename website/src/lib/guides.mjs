// One list of guides for the side menu and the dashboard cards.
// group: 'main' shows in the menu body, 'ref' under the technical reference divider.
// art: a 48x48 drawing for the dashboard card; the part with class "m" moves once on hover or tap.
// Drawing colours use A (accent), D (icon fill), Y (amber), G (green) and B (page ground).

const A = 'var(--tf-accent)'
const D = 'var(--tf-raised)'
const Y = '#f59e0b'
const G = '#22c55e'
const B = 'var(--tf-ground)'

export const guides = [
  {
    slug: 'installation', group: 'main', card: true,
    fa: ['نصب', 'نصب پنل و ایجاد حساب مدیر.'], en: ['Installation', 'Install the panel and create the admin account.'],
    icon: 'M12 3v12m-5-5 5 5 5-5M5 20h14',
    art: `<rect x="6" y="30" width="36" height="12" rx="4" fill="${D}" stroke="${A}" stroke-width="2"/><circle cx="35" cy="36" r="2" fill="${G}"/><g class="m drop"><path d="M24 5v17" stroke="${A}" stroke-width="4" stroke-linecap="round"/><path d="M15 15l9 10 9-10" fill="none" stroke="${A}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  },
  {
    slug: 'nodes', group: 'main', card: true,
    fa: ['نودها', 'ثبت، نصب و اتصال سرورهای خارج.'], en: ['Nodes', 'Register, install and connect servers abroad.'],
    icon: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
    art: `<rect x="7" y="6" width="34" height="15" rx="4" fill="${D}" stroke="${A}" stroke-width="2"/><rect x="7" y="27" width="34" height="15" rx="4" fill="${D}" stroke="${A}" stroke-width="2"/><path d="M22 13.5h13M22 34.5h13" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-linecap="round"/><g class="m blink"><circle cx="14" cy="13.5" r="2.6" fill="${G}"/><circle cx="14" cy="34.5" r="2.6" fill="${G}"/></g>`,
  },
  {
    slug: 'cores-and-hosts', group: 'main', card: true,
    fa: ['هسته‌ها و هاست‌ها', 'پیکربندی پروتکل‌ها، نشانی‌ها و گروه‌ها.'], en: ['Cores and hosts', 'Protocols, addresses and user groups.'],
    icon: 'M8 8h8v8H8zM10 4v4m4-4v4m-4 8v4m4-4v4M4 10h4m-4 4h4m8-4h4m-4 4h4',
    art: `<path d="M17 4v7M24 4v7M31 4v7M17 37v7M24 37v7M31 37v7M4 17h7M4 24h7M4 31h7M37 17h7M37 24h7M37 31h7" stroke="${A}" stroke-width="2" stroke-linecap="round"/><rect x="11" y="11" width="26" height="26" rx="5" fill="${D}" stroke="${A}" stroke-width="2"/><rect class="m pulse" x="18" y="18" width="12" height="12" rx="2.5" fill="${A}"/>`,
  },
  {
    slug: 'users-and-subscriptions', group: 'main', card: true,
    fa: ['کاربران', 'حجم، مدت، محدودیت دستگاه و اشتراک‌ها.'], en: ['Users', 'Traffic, expiry, device limits and subscriptions.'],
    icon: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6m11.5 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
    art: `<circle cx="33" cy="17" r="6" fill="${D}" stroke="${A}" stroke-width="2"/><path d="M24 40c0-7 4-11 9-11s9 4 9 11" fill="${D}" stroke="${A}" stroke-width="2"/><g class="m bob"><circle cx="18" cy="15" r="7" fill="${A}"/><path d="M5 41c0-9 6-14 13-14s13 5 13 14Z" fill="${A}"/></g>`,
  },
  {
    slug: 'resellers', group: 'main', card: true,
    fa: ['نمایندگان', 'اعتبار و کاربران مستقل برای هر نماینده.'], en: ['Resellers', 'Separate balance and users for each reseller.'],
    icon: 'M4 9h16v10H4zM9 9V6a3 3 0 0 1 6 0v3M4 13h16',
    art: `<ellipse cx="24" cy="36" rx="14" ry="5" fill="${D}" stroke="${A}" stroke-width="2"/><ellipse cx="24" cy="28" rx="14" ry="5" fill="${D}" stroke="${A}" stroke-width="2"/><g class="m bob"><ellipse cx="24" cy="18" rx="14" ry="5.5" fill="${Y}"/><path d="M24 15v6M21.5 16.5h4a1.5 1.5 0 0 1 0 3h-3" fill="none" stroke="#5a4208" stroke-width="1.6" stroke-linecap="round"/></g>`,
  },
  {
    slug: 'tunnels', group: 'main', card: true,
    fa: ['تانل‌ها', 'اتصال ایران به خارج: مستقیم، CDN یا Spoof.'], en: ['Tunnels', 'Iran to abroad: direct, through a CDN, or spoof.'],
    icon: 'M3 20V12a9 9 0 0 1 18 0v8M8 20v-7a4 4 0 0 1 8 0v7',
    art: `<path d="M3 42h42" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-linecap="round"/><path d="M6 42V25a18 18 0 0 1 36 0v17Z" fill="${A}"/><path d="M13 42V26a11 11 0 0 1 22 0v16Z" fill="${B}"/><path d="M24 41v-4M24 34v-3" stroke="rgba(255,255,255,.5)" stroke-width="2" stroke-linecap="round"/><circle class="m drive" cx="24" cy="36" r="3" fill="${Y}"/>`,
  },
  {
    slug: 'telegram-bot', group: 'main', card: true,
    fa: ['ربات تلگرام', 'فروش و تمدید خودکار اشتراک.'], en: ['Telegram bot', 'Sell and renew subscriptions automatically.'],
    icon: 'M21 4 3 11l6 2 2 6 3-4 5 4z',
    art: `<circle cx="24" cy="24" r="20" fill="${D}" stroke="${A}" stroke-width="2"/><path class="m fly" d="M10.6 23.6c6.3-2.7 10.5-4.5 12.6-5.4 6-2.5 7.2-2.9 8.1-2.9.2 0 .6 0 .9.3.2.2.3.4.3.6 0 .2.1.6 0 .9-.3 3.4-1.7 11.7-2.4 15.5-.3 1.6-.9 2.2-1.5 2.2-1.3.1-2.2-.8-3.4-1.6-1.9-1.2-3-2-4.8-3.2-2.1-1.4-.8-2.2.5-3.4.3-.3 5.8-5.4 6-5.8 0-.1 0-.3-.1-.4s-.3-.1-.4 0c-.2 0-3.2 2-9.1 6-.9.6-1.6.9-2.3.9-.8 0-2.3-.4-3.4-.8-1.4-.4-2.4-.7-2.3-1.4 0-.4.6-.8 1.3-1.5Z" fill="${A}"/>`,
  },
  {
    slug: 'network-health', group: 'main', card: true,
    fa: ['سلامت شبکه', 'پایش زندهٔ نودها و تانل‌ها.'], en: ['Network health', 'Live checks for nodes and tunnels.'],
    icon: 'M3 12h4l3-8 4 16 3-8h4',
    art: `<rect x="5" y="8" width="38" height="32" rx="7" fill="${D}" stroke="${A}" stroke-width="2"/><path class="m draw" d="M9 25h8l4-9 6 17 4-8h8" fill="none" stroke="${G}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    slug: 'updates-and-rollback', group: 'main', card: true,
    fa: ['به‌روزرسانی', 'نصب نسخهٔ جدید با امکان بازگشت.'], en: ['Updates', 'Install a new version with a way back.'],
    icon: 'M4 12a8 8 0 0 1 14-5l2 2M20 4v5h-5M20 12a8 8 0 0 1-14 5l-2-2M4 20v-5h5',
    art: `<circle cx="24" cy="24" r="19" fill="${D}" stroke="rgba(255,255,255,.14)" stroke-width="2"/><g class="m spin"><path d="M13 22a11 11 0 0 1 19-6l3 3" fill="none" stroke="${A}" stroke-width="3.2" stroke-linecap="round"/><path d="M35 11v8h-8" fill="none" stroke="${A}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M35 26a11 11 0 0 1-19 6l-3-3" fill="none" stroke="${A}" stroke-width="3.2" stroke-linecap="round"/><path d="M13 37v-8h8" fill="none" stroke="${A}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  },
  {
    slug: 'operations', group: 'main', card: true,
    fa: ['عملیات', 'فرمان مدیریت، مدیران و تنظیمات.'], en: ['Operations', 'Management command, admins and settings.'],
    icon: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
    art: `<rect x="5" y="6" width="38" height="36" rx="7" fill="${D}" stroke="${A}" stroke-width="2"/><path d="M12 17h24M12 31h24" stroke="rgba(255,255,255,.3)" stroke-width="2.5" stroke-linecap="round"/><circle class="m slide" cx="19" cy="17" r="5" fill="${A}"/><circle class="m slide2" cx="30" cy="31" r="5" fill="${Y}"/>`,
  },
  {
    slug: 'deployment', group: 'ref',
    fa: ['مرجع استقرار', 'پورت‌ها، متغیرهای محیطی و کانتینرها.'], en: ['Deployment', 'Ports, environment variables and containers.'],
    icon: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  },
  {
    slug: 'architecture', group: 'ref',
    fa: ['معماری', 'اجزای پنل، نودها و مسیر داده.'], en: ['Architecture', 'Panel, nodes and the data path.'],
    icon: 'M4 4h6v6H4zM14 14h6v6h-6zM7 10v4a3 3 0 0 0 3 3h4',
  },
  {
    slug: 'development', group: 'ref',
    fa: ['توسعه', 'ساخت از سورس و مشارکت.'], en: ['Development', 'Build from source and contribute.'],
    icon: 'm8 8-4 4 4 4m8-8 4 4-4 4M14 5l-4 14',
  },
]

export const homeIcon = 'M4 11 12 4l8 7v9h-5v-6H9v6H4z'

// SVG presentation attributes can't hold var(); move them into a style attribute.
export function cssColors(svg) {
  return svg.replace(/<([a-z]+)([^>]*?)(\/?)>/g, (tag, name, attrs, close) => {
    const style = []
    const rest = attrs.replace(/\s(fill|stroke)="(var\([^"]+\))"/g, (_, k, v) => { style.push(`${k}:${v}`); return '' })
    return style.length ? `<${name}${rest} style="${style.join(';')}"${close}>` : tag
  })
}
