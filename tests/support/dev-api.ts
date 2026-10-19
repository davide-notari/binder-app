// Type of the API exposed by the dev render page (src/dev/render-page.tsx) to the Playwright tests.
export interface BinderDevApi {
  renderAt(t: number): void;
  readPixelsBase64(): string;
  info(): Record<string, unknown>;
}

declare global {
  interface Window {
    __binderDev?: BinderDevApi;
  }
}
