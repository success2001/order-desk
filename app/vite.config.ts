/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      // Ask before updating (UpdatePrompt) so an update never reloads the page mid-entry.
      registerType: 'prompt',
      // Generates PNG icons, favicon.ico and head links from the SVG at build time.
      pwaAssets: {
        preset: 'minimal-2023',
        image: 'public/favicon.svg',
      },
      manifest: {
        name: 'Order Tracker',
        short_name: 'Orders',
        description: 'Track orders, payments and deliveries for WhatsApp and Instagram sales.',
        lang: 'en-NG',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0f7b4b',
        background_color: '#ffffff',
      },
      workbox: {
        // Precache the app shell so it opens with no connection.
        // No 'webmanifest' here: the plugin adds the manifest itself, and a duplicate
        // entry with a different revision makes Workbox skip precaching entirely.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    // Live tests hit the real Supabase project: only with `npm run test:live` (--mode live).
    include: mode === 'live' ? ['src/**/*.live.test.ts'] : ['src/**/*.test.{ts,tsx}'],
    exclude: mode === 'live' ? [] : ['src/**/*.live.test.ts'],
    testTimeout: mode === 'live' ? 60_000 : 5_000,
    hookTimeout: mode === 'live' ? 60_000 : 10_000,
  },
}))
