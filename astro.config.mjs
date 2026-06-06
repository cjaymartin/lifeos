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
  // experimentalDisableStreaming: render each page fully before sending headers.
  // With HTML streaming on, an island that throws during SSR aborts *after* a
  // 200 + partial body are already on the wire — the Node adapter can only reset
  // the socket (or, depending where the throw lands, hang until the browser
  // times out), leaving no error page and nothing actionable (NIM-5). Buffering
  // makes a render throw surface before headers go out, so Astro returns a real
  // 500 error page instead. Pages here are small and data is local, so the lost
  // streaming is imperceptible. Regression-tested by tests/qa case GROC-13.
  adapter: node({ mode: 'standalone', experimentalDisableStreaming: true }),
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
