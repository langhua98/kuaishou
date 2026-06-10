import { defineConfig } from 'vite'

function iifeScriptTag() {
  return {
    name: 'iife-script-tag',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g,
                 '<script defer src="$1"></script>')
        .replace(/<script type="module" src="([^"]+)"><\/script>/g,
                 '<script defer src="$1"></script>')
    }
  }
}

export default defineConfig({
  base: '/kuaishou/',
  build: {
    outDir: 'dist',
    target: ['es2019', 'safari12'],
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'MC',
        entryFileNames: 'assets/[name]-[hash].js',
      }
    }
  },
  plugins: [iifeScriptTag()],
})
