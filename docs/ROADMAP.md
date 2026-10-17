# Roadmap

Each milestone ends with: tests green, a short report to Davide (what was done, how it was verified, open risks),
a commit. Do not start the next milestone before Davide confirms. Real-device checks are done by Davide on his
iPhone; prepare exact instructions for him (URL, what to tap, what to look at).

## M0 — Scaffold and deploy
- Vite + TypeScript (strict) + Preact project, ESLint/Prettier, Vitest, Playwright (WebKit).
- `vite.config.ts`: `base` `/binder-app/` in production; dev server serves `tests/fixtures/cards-repo`
  (or `VITE_LOCAL_CARDS`) under `/dev-cards/`; `server.allowedHosts` accepts `.trycloudflare.com` (iPhone testing
  through a tunnel, see GUIDA_SETUP part H).
- `.env.production` with `VITE_CARDS_OWNER` (Davide's GitHub user), `VITE_CARDS_REPO=binder-cards`, `VITE_CARDS_BRANCH=main`.
- Copy `docs/templates/deploy-pages.yml` to `.github/workflows/` (adjust the Node version if needed).
- A placeholder page "Raccoglitore" deployed on GitHub Pages.
- **Done when:** `npm run build`, `npm test` pass; the Pages URL opens on the iPhone.

## M1 — Renderer and fidelity (the most important milestone)
- WebGL2 renderer exactly as RENDERING.md §1–4, loading a card through `LocalSource`.
- Dev page `/?dev=render&card=testcard&t=<sec>` and the Playwright fidelity test of RENDERING.md §8 on
  `testcard` (all reference frames).
- Premultiplied-upload unit test (RENDERING.md §2).
- Same test also runnable on real cards with `CARDS_DIR=../binder-cards` (reports only, nothing copied).
- **Done when:** fidelity thresholds met on the test card in WebKit and on Celebi locally; Davide checks Celebi's
  home view and three track times on his iPhone against the preview video.

## M2 — Card view: modes, tilt, immersive
- Card view state machine (SPEC.md §6) with the local source: Carta / Artwork, 3D, long press, immersive playback
  at 60 fps with slerp, transitions, tilt zoom computation, debug overlay with tilt tuning (MAX_ANGLE, MAX_OFFSET,
  axis signs).
- Resolution choice full/half (CARD_FORMAT.md §5) and memory budget, logged in the debug overlay.
- HTTPS testing on the iPhone during development (Davide uses a tunnel, see GUIDA_SETUP).
- **Done when:** on the iPhone: tilt is smooth and never shows a cut edge on the 4 real cards; immersive matches the
  approved video; no visible jump entering/leaving 3D or immersive; no crash after opening the 4 cards repeatedly.

## M3 — GitHub source, onboarding, cache
- `GitHubSource`, key screen, token storage, error handling (SPEC.md §4).
- Store: index refresh with ETag, version invalidation, base prefetch, on-demand layers, LRU, `storage.persist()`.
- Install guide screen when not standalone.
- **Done when:** on the iPhone, from the Pages URL: install, paste key, cards load from the private repo;
  airplane mode → binder and cached cards still work; a re-exported card (new version) is refreshed automatically;
  a revoked token shows the key screen.

## M4 — Binder and settings
- Grid, badges, progress indicators, settings screen (SPEC.md §5–6), update prompt for new app versions.
- **Done when:** Davide approves look and flow on the iPhone.

## M5 — Hardening and handover
- Tests on the oldest available iPhone (memory), context loss (app in background for minutes), low storage behaviour,
  first-launch flow on a phone that never saw the app.
- Icons/name from Davide; final README for adding cards and revoking keys.
- **Done when:** installed and working on the brother's iPhone.
