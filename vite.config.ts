import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Stamped by CI (APP_VERSION=1.0.<run>); local builds show "dev".
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
  },
  plugins: [
    VitePWA({
      // 'prompt': a new service worker waits instead of activating silently —
      // main.ts's registerSW() hook surfaces it as a toast + pause-menu
      // "Update App" button, and users who never tap still get the new
      // version on their next cold start (the waiting worker activates once
      // the old one has no clients left).
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Causeway to Ériu',
        short_name: 'Causeway',
        description: 'A mobile-first block-building/roguelike hybrid dungeon crawler',
        theme_color: '#08090a',
        background_color: '#08090a',
        display: 'standalone',
        orientation: 'portrait',
        // "." (not "/") so it resolves relative to the manifest's own URL —
        // works whether this is served from the domain root (Cloudflare
        // Pages) or a subpath (GitHub Pages project sites, via --base).
        start_url: '.',
        icons: [
          { src: 'icons/icon-48.png',  sizes: '48x48',   type: 'image/png' },
          { src: 'icons/icon-72.png',  sizes: '72x72',   type: 'image/png' },
          { src: 'icons/icon-96.png',  sizes: '96x96',   type: 'image/png' },
          { src: 'icons/icon-128.png', sizes: '128x128', type: 'image/png' },
          { src: 'icons/icon-144.png', sizes: '144x144', type: 'image/png' },
          { src: 'icons/icon-152.png', sizes: '152x152', type: 'image/png' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-384.png', sizes: '384x384', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          {
            src: 'screenshots/desktop-1.png', sizes: '682x800', type: 'image/png',
            form_factor: 'wide', label: 'Building the dungeon floor with falling blocks while exploring as An Draoi',
          },
          {
            src: 'screenshots/mobile-1.png', sizes: '780x1688', type: 'image/png',
            form_factor: 'narrow', label: 'A run in progress on mobile — block-building layer above, hero layer below',
          },
        ],
      },
    }),
  ],
});
