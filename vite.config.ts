import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { publicMetadata } from './shared/metadata.mjs'

export default defineConfig({
  plugins: [react(), {
    name: 'public-sharing-metadata',
    transformIndexHtml: (html) => publicMetadata(html, process.env.PUBLIC_URL),
  }],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
