// Copies docs/{fa,en}/*.md into the Starlight content folder, so the repo's
// Markdown stays the single source and the site is rebuilt from it.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const OUT = new URL('../src/content/docs', import.meta.url).pathname
const REPO = 'https://github.com/javadtifusi-eng/Tifusi-Panel/blob/main/'

// Extra blocks shown under a page's first paragraph, e.g. panel screenshots.
const inserts = {
  tunnels: (lang) => {
    const fa = lang === 'fa'
    const shot = (file, alt) => `![${alt}](../../../../assets/shots/${file})`
    return [
      shot(`tunnels-${lang}.webp`, fa ? 'بخش تانل‌ها: نقشه‌ی زنده‌ی سرورها و ترافیک هر تانل' : 'Tunnels: live map of servers and traffic per tunnel'),
      '',
      fa ? '*نقشه‌ی زنده: هر تانل هر ۱۵ ثانیه تست می‌شود و نمودار ترافیک هر ثانیه به‌روز می‌شود.*' : '*Live map: every tunnel is re-tested every 15 seconds and its traffic graph updates each second.*',
    ].join('\n')
  },
}
// Live panel screenshots (docs/../website/src/assets/shots/<tab>-<lang>.webp).
const panelShots = {
  nodes: [['nodes', 'بخش نودها: وضعیت زنده‌ی نود، ترافیک روزانه و سرویس‌ها', 'Nodes: live node status, daily traffic and services']],
  'users-and-subscriptions': [['users', 'بخش کاربران: آمار زنده، پرمصرف‌ترین‌ها و لیست کاربران', 'Users: live stats, top usage and the user list']],
  'cores-and-hosts': [
    ['cores', 'بخش هسته‌ها: هسته‌ها و مسیر ترافیک', 'Cores: cores and the traffic flow'],
    ['hosts', 'بخش هاست‌ها: نقشه‌ی پروتکل‌ها و کارت هر هاست', 'Hosts: protocol map and a card for each host'],
    ['groups', 'بخش گروه‌ها: نقشه‌ی دسترسی کاربران به هاست‌ها', 'Groups: which users reach which hosts'],
  ],
  resellers: [['resellers', 'بخش نمایندگان', 'Resellers']],
  'network-health': [['overview', 'داشبورد: سلامت سیستم، فعالیت زنده و ترافیک', 'Dashboard: system health, live activity and traffic']],
}
for (const [slug, shots] of Object.entries(panelShots)) {
  inserts[slug] = (lang) =>
    shots.map(([tab, fa, en]) => `![${lang === 'fa' ? fa : en}](../../../../assets/shots/${tab}-${lang}.webp)`).join('\n\n')
}

const cdnShot = (lang) =>
  `![${lang === 'fa' ? 'تانل با عبور از ابر آروان و چک‌لیست راه‌اندازی' : 'A tunnel routed through ArvanCloud with its setup checklist'}](../../../../assets/shots/tunnel-cdn-${lang}.webp)`

function convert(src, lang, slug) {
  let lines = src.split('\n')
  // Drop the top navigation line and the prev/next footer after the last rule.
  if (lines[0].includes('<sub>')) lines = lines.slice(1)
  const lastRule = lines.lastIndexOf('---')
  if (lastRule > 0 && lines.slice(lastRule).some((l) => l.includes('<sub>'))) lines = lines.slice(0, lastRule)
  lines = lines.filter((l) => !/^<div dir="rtl">$|^<\/div>$/.test(l.trim()))
  let body = lines.join('\n').trim()
  const title = body.match(/^# (.+)$/m)?.[1]?.trim() ?? slug
  body = body.replace(/^# .+\n+/m, '')
  body = body.replace(/```mermaid\n([\s\S]*?)```/g, (_, g) => `<pre class="mermaid">\n${g.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`)
  body = body.replace(/\]\(([a-z0-9-]+)\.md(#[^)]*)?\)/g, (_, name, hash = '') => `](../${name}/${hash})`)
  body = body.replace(/\]\((?:\.\.\/)+([^)]+)\)/g, (_, p) => (p.startsWith('screenshots/') ? `](${REPO}docs/${p})` : `](${REPO}${p})`))
  if (inserts[slug]) {
    const i = body.indexOf('\n\n')
    body = `${body.slice(0, i)}\n\n${inserts[slug](lang)}${body.slice(i)}`
  }
  if (slug === 'tunnels') body = body.replace(/(\n## [^\n]*CDN[^\n]*\n)/, `$1\n${cdnShot(lang)}\n`)
  return `---\ntitle: ${JSON.stringify(title)}\ntemplate: splash\n---\n\n${body}\n`
}

for (const lang of ['fa', 'en']) {
  const out = join(OUT, lang, 'guides')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const file of readdirSync(join(ROOT, 'docs', lang)).filter((f) => f.endsWith('.md'))) {
    const slug = file.replace(/\.md$/, '')
    writeFileSync(join(out, file), convert(readFileSync(join(ROOT, 'docs', lang, file), 'utf8'), lang, slug))
  }
}
