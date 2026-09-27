import starlight from '@astrojs/starlight'
import { defineConfig, passthroughImageService } from 'astro/config'

const guides = [
  'installation', 'nodes', 'hysteria2', 'cores-and-hosts', 'users-and-subscriptions', 'resellers',
  'tunnels', 'connection-shield', 'telegram-bot', 'android-app', 'network-health', 'operations',
  'deployment', 'architecture', 'development',
]

export default defineConfig({
  site: 'https://javadtifusi-eng.github.io',
  base: '/Tifusi-Panel',
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: { fa: 'مستندات تیفوسی پنل', en: 'Tifusi Panel Docs' },
      logo: { src: './src/assets/logo.png', alt: 'Tifusi Panel' },
      favicon: '/favicon.png',
      defaultLocale: 'fa',
      locales: {
        fa: { label: 'فارسی', lang: 'fa', dir: 'rtl' },
        en: { label: 'English', lang: 'en' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/javadtifusi-eng/Tifusi-Panel' }, { icon: 'telegram', label: 'Telegram', href: 'https://t.me/javadheydeari' }],
      customCss: ['./src/styles/theme.css'],
      head: [
        { tag: 'script', attrs: { type: 'module' }, content: "if (document.querySelector('pre.mermaid')) { const m = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default; m.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark' }); await m.run({ querySelector: 'pre.mermaid' }) }" },
      ],
      sidebar: [
        { label: 'Guides', translations: { fa: 'راهنماها' }, items: guides.map((g) => `guides/${g}`) },
      ],
      editLink: { baseUrl: 'https://github.com/javadtifusi-eng/Tifusi-Panel/edit/main/docs/' },
      lastUpdated: false,
    }),
  ],
})
