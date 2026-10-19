import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, loadEnv } from 'vite';
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

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, projectRoot, 'VITE_');
  const configuredCards = env.VITE_LOCAL_CARDS ?? '';
  const localCards = path.resolve(projectRoot, configuredCards === '' ? DEFAULT_LOCAL_CARDS : configuredCards);

  return {
    // GitHub Pages serves the app from https://<owner>.github.io/binder-app/
    base: command === 'build' ? '/binder-app/' : '/',
    plugins: [preact(), devCards(localCards)],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion()),
    },
    server: {
      // iPhone testing through a temporary Cloudflare tunnel (GUIDA_SETUP part H)
      allowedHosts: ['.trycloudflare.com'],
    },
  };
});
