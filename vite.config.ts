import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: 'localhost',
    port: 1420,
    strictPort: true,
    watch: {
      // Cargo writes/locks native build artifacts while the frontend is running.
      ignored: ['**/src-tauri/**', '**/output/**', '**/.playwright-cli/**'],
    },
  },
  preview: {
    host: 'localhost',
    port: 1421,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
})
