import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // reachable from phones on the same network
    // HTTPS tunnels for phone testing (the camera and mic need https://).
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'],
    // Same-origin API in dev: one tunnel to this port serves the app, the API and the WebSockets.
    proxy: { '/api': { target: 'http://localhost:5001', ws: true } },
  },
})
