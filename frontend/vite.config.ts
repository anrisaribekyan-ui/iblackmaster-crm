import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Запросы /api/* в режиме разработки проксируются на бэкенд (uvicorn на порту 8000)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      // Доска закупок (раздел «Закупки»): локальный сервис «Доска», по умолчанию порт 8090
      '/zakupki-app': {
        target: process.env.DOSKA_DEV_URL || 'http://127.0.0.1:8090',
        rewrite: (path) => path.replace(/^\/zakupki-app/, '') || '/',
      },
    },
  },
})
