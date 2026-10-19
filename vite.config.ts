import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { devCards } from './tools/dev-cards.ts';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_LOCAL_CARDS = 'tests/fixtures/cards-repo';

function appVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { version: string };
  let commit = process.env.GITHUB_SHA?.slice(0, 7);
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short=7 HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    } catch {
      commit = 'local';
    }
  }
  return `${pkg.version}+${commit}`;
}

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, projectRoot, 'VITE_');
  const configuredCards = env.VITE_LOCAL_CARDS ?? '';
  const localCards = path.resolve(projectRoot, configuredCards === '' ? DEFAULT_LOCAL_CARDS : configuredCards);

  return {
    // GitHub Pages serves the app from https://<owner>.github.io/binder-app/ (also `vite preview` of the build)
    base: command === 'serve' && !isPreview ? '/' : '/binder-app/',
    plugins: [
      preact(),
      devCards(localCards),
      // App shell only (SPEC.md §7): card data is cached by src/data/store.ts, never by the service worker.
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          name: 'Raccoglitore',
          description: 'Il raccoglitore delle carte',
          short_name: 'Raccoglitore',
          lang: 'it',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#111111',
          theme_color: '#111111',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
          cleanupOutdatedCaches: true,
          runtimeCaching: [],
        },
        devOptions: { enabled: false },
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion()),
    },
    server: {
      // iPhone testing through a temporary Cloudflare tunnel (GUIDA_SETUP part H)
      allowedHosts: ['.trycloudflare.com'],
    },
  };
});
