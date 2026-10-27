import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        workbox: {
          // Never answer API requests from the service worker
          navigateFallbackDenylist: [/^\/api/]
        },
        manifest: {
          name: 'Echo',
          short_name: 'Echo',
          description: 'Voice Cloning PWA',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    server: {
      host: true,
      port: 5173,
      // Forward API calls to the backend during development
      proxy: {
        '/api': env.VITE_PROXY_TARGET || 'http://localhost:8000'
      }
    },
    preview: {
      port: 4173
    }
  };
});
