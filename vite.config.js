import { defineConfig } from 'vite'

// Remove crossorigin attribute Vite adds to module scripts — it can cause
// iOS Safari to silently reject the script via a CORS preflight failure.
function removeCrossorigin() {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '')
    }
  }
}

export default defineConfig({
  base: '/kuaishou/',
  build: {
    outDir: 'dist',
    target: ['es2019', 'safari12'],
  },
  plugins: [removeCrossorigin()],
})
