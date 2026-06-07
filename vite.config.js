import { defineConfig } from 'vite'

export default defineConfig({
  base: '/kuaishou/',
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
})
