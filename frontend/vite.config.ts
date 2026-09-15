import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { defineConfig, type Plugin } from 'vite'

// Writes a max-level .gz next to every text asset so nginx's gzip_static can
// send it as-is: smaller than on-the-fly compression and no CPU per request,
// which matters on a small VPS reached over slow links from Iran.
function precompress(): Plugin {
  let outDir = 'dist'
  return {
    name: 'tifusi-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const file = join(dir, name)
          if (statSync(file).isDirectory()) walk(file)
          else if (/\.(js|css|html|svg|json|webmanifest)$/.test(name)) {
            const raw = readFileSync(file)
            const gz = gzipSync(raw, { level: 9 })
            if (gz.length < raw.length) writeFileSync(`${file}.gz`, gz)
          }
        }
      }
      walk(outDir)
    },
  }
}

export default defineConfig({
  plugins: [react(), precompress()],
  // Everything ships as one JS and one CSS file: the panel is a single screen
  // app, so one cached request each beats a waterfall of small chunks.
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
  },
  esbuild: {
    drop: ['console', 'debugger'],
    legalComments: 'none',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
