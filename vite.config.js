import { defineConfig } from 'vite'

export default defineConfig({
  base: '/kuaishou/',
  build: {
    outDir: 'dist',
    target: ['es2019', 'safari12'],
  },
})
