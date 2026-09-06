import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', ws: true },
    },
    watch: {
      usePolling: true,
      interval: 5000,
    },
  },
})
