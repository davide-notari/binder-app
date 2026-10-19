/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CARDS_OWNER?: string;
  readonly VITE_CARDS_REPO?: string;
  readonly VITE_CARDS_BRANCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** "<package version>+<short commit>", injected by vite.config.ts. */
declare const __APP_VERSION__: string;
