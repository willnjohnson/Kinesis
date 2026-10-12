import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    // Fonts stay files of their own, however small: a small one would otherwise be written into the stylesheet as a
    // data: address, which the app's content security policy (font-src, tauri.conf.json) doesn't let load. The maths
    // fonts (KaTeX) include one that small.
    assetsInlineLimit: file => (/\.(woff2?|ttf|otf|eot)$/i.test(file) ? false : undefined),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
