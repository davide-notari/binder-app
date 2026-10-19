// Development-only Vite plugin: serves a local card repository (the test fixtures or a checkout of
// binder-cards) under /dev-cards/, with the same layout as the private repository.
// It is never part of a production build (apply: 'serve').
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const DEV_CARDS_MOUNT = '/dev-cards';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

/** Content type for a servable file, or null if the extension is not served. */
export function contentTypeFor(filePath: string): string | null {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

/**
 * Maps a request path (relative to the mount point, e.g. "/cards/x.card/card.json") to an absolute file path
 * inside `root`. Returns null for anything that could escape the root, hidden files (".git", ".DS_Store")
 * and file types that are not card data.
 */
export function resolveInside(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((s) => s.length > 0);
  if (segments.length === 0 || segments.some((s) => s.startsWith('.'))) return null;

  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...segments);
  if (!target.startsWith(absoluteRoot + path.sep)) return null;
  if (contentTypeFor(target) === null) return null;
  return target;
}

export function devCards(root: string): Plugin {
  return {
    name: 'binder:dev-cards',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info(`  dev cards: ${DEV_CARDS_MOUNT}/ -> ${path.relative(process.cwd(), root)}`);
      server.middlewares.use(DEV_CARDS_MOUNT, (req, res) => {
        const requestPath = (req.url ?? '/').split('?')[0] ?? '/';
        const filePath = req.method === 'GET' || req.method === 'HEAD' ? resolveInside(root, requestPath) : null;
        let size = -1;
        if (filePath !== null) {
          try {
            const stats = statSync(filePath);
            if (stats.isFile()) size = stats.size;
          } catch {
            // missing file: answered with 404 below
          }
        }
        if (filePath === null || size < 0) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', contentTypeFor(filePath) ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(size));
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(filePath).pipe(res);
      });
    },
  };
}
