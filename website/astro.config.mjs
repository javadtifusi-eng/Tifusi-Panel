import starlight from '@astrojs/starlight'
import { defineConfig, passthroughImageService } from 'astro/config'

const guides = [
  'installation', 'nodes', 'cores-and-hosts', 'users-and-subscriptions', 'resellers',
  'tunnels', 'telegram-bot', 'network-health', 'operations', 'updates-and-rollback',
  'deployment', 'architecture', 'development',
]

export default defineConfig({
  site: 'https://javadtifusi-eng.github.io',
  base: '/Tifusi-Panel',
  // Hysteria2 now lives inside the cores guide.
  redirects: {
    '/fa/guides/hysteria2': '/Tifusi-Panel/fa/guides/cores-and-hosts/#hysteria2',
    '/en/guides/hysteria2': '/Tifusi-Panel/en/guides/cores-and-hosts/#hysteria2',
  },
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: { fa: 'مستندات تیفوسی پنل', en: 'Tifusi Panel Docs' },
      logo: { src: './src/assets/emblem.png', alt: 'Tifusi Panel' },
      favicon: '/favicon.png',
      defaultLocale: 'fa',
      locales: {
        fa: { label: 'فارسی', lang: 'fa', dir: 'rtl' },
        en: { label: 'English', lang: 'en' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/javadtifusi-eng/Tifusi-Panel' }, { icon: 'telegram', label: 'Telegram', href: 'https://t.me/javadheydeari' }],
      customCss: ['./src/styles/theme.css'],
      // Plain command boxes; the copy button is added below each one by the script in head.
      expressiveCode: { defaultProps: { frame: 'none' }, frames: { showCopyToClipboardButton: false } },
      components: {
        Header: './src/components/Header.astro',
        ThemeProvider: './src/components/DarkTheme.astro',
        ThemeSelect: './src/components/Empty.astro',
        PageTitle: './src/components/PageTitle.astro',
        Sidebar: './src/components/Sidebar.astro',
      },
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' } },
        // Older Safari has no popover API, which Starlight's phone menu needs: open and close it by class instead.
        { tag: 'script', content: `(function(){if('popover' in HTMLElement.prototype)return;var d=document.documentElement;d.classList.add('no-popover');document.addEventListener('DOMContentLoaded',function(){var pane=document.getElementById('starlight__sidebar'),btn=document.querySelector('.sl-menu-button');if(!pane||!btn)return;btn.addEventListener('click',function(e){e.preventDefault();var o=!d.classList.contains('menu-open');d.classList.toggle('menu-open',o);btn.setAttribute('aria-expanded',o)});pane.addEventListener('click',function(e){if(e.target.closest('a'))d.classList.remove('menu-open')});})})();` },
        // Copy buttons: a full-width orange button under every command, with a fallback for older Safari.
        { tag: 'script', content: `(function(){function legacy(t){var a=document.createElement('textarea');a.value=t;a.setAttribute('readonly','');a.style.cssText='position:fixed;top:0;opacity:0';document.body.appendChild(a);a.select();a.setSelectionRange(0,t.length);var ok=false;try{ok=document.execCommand('copy')}catch(e){}a.remove();return ok}window.tfCopy=function(t){if(navigator.clipboard&&window.isSecureContext){return navigator.clipboard.writeText(t).then(function(){return true},function(){return legacy(t)})}return Promise.resolve(legacy(t))};document.addEventListener('DOMContentLoaded',function(){var fa=document.documentElement.lang==='fa',L=fa?'کپی دستور':'Copy command',D=fa?'کپی شد ✓':'Copied ✓',F=fa?'کپی نشد؛ دستور را انتخاب کنید':'Copy failed; select the command';document.querySelectorAll('.sl-markdown-content .expressive-code').forEach(function(ec){var code=ec.querySelector('pre code');if(!code)return;var row=document.createElement('div');row.className='tf-copyrow not-content';var b=document.createElement('button');b.type='button';b.className='tf-chip tf-go tf-copy';b.textContent=L;b.addEventListener('click',function(){var t=Array.prototype.map.call(code.querySelectorAll('.ec-line'),function(l){return l.textContent}).join('\\n')||code.textContent;window.tfCopy(t).then(function(ok){b.textContent=ok?D:F;setTimeout(function(){b.textContent=L},1800)})});row.appendChild(b);ec.after(row)})})})();` },
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
