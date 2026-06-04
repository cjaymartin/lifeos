// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: '0.0.0.0', port: 4321 },
  security: {
    // Trust Traefik's X-Forwarded-Proto/Host for these hosts — without this the
    // adapter sees requests as http://, the https:// Origin header mismatches,
    // and the built-in CSRF check 403s every bodyless POST (refresh buttons).
    allowedDomains: [
      { hostname: 'lifeos.localhost', protocol: 'https' },
      { hostname: 'lifeos.wolfdivided', protocol: 'https' },
    ],
  },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  },
});
