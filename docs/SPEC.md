# Binder — specification

## 1. What it is

A private digital **binder** of custom Pokémon cards painted by Davide as a wedding gift for his brother.
Every card can be seen as:

- **Carta** — the full card with its Pokémon card layout (`front.webp`);
- **Artwork** — only the artwork, rendered in 2.5D from separated layers: with **3D** on it moves in parallax
  when the phone is tilted; some cards also have an **immersive** camera flight into the scene (the same camera path
  approved in the preview videos).

Target: any iPhone (any screen size) with iOS 17 or later, installed as a Home Screen web app (PWA).
UI language: **Italian**. Code, identifiers, file names, data keys, comments and commits: **English**.

## 2. Key decisions (already taken, do not reopen without asking)

| Decision | Reason |
|---|---|
| PWA, not a native IPA | An ad hoc / TestFlight IPA expires (yearly / 90 days) and would need reinstalling. A Home Screen web app never expires and works offline. |
| Real-time WebGL2 rendering, not videos | Native resolution, no video compression, smaller downloads, tilt and immersive in one scene. Fidelity is enforced by tests against the approved preview frames. |
| Two repositories | `binder-app` (code, deployed to GitHub Pages; contains **no real artwork**) and `binder-cards` (private; card data). |
| Access with a personal key | Each person gets a GitHub fine-grained token: read-only, only `binder-cards`, no expiry, revocable one by one. |
| Card data downloaded on demand and cached | Base assets of every card are kept (binder works offline); 3D layers only when a card is opened, in a size-limited cache. |
| No effects, no holographic foil in v1 | Not essential; may come later. |
| Static layers only | Only the camera moves (approved style). |

## 3. Architecture

```
┌──────────────────────────── iPhone (Home Screen web app, standalone) ────────────────────────────┐
│  App shell (HTML/JS/CSS, ~hundreds of KB) — precached by the service worker, works offline       │
│                                                                                                  │
│  UI (Preact)  ──  CardStore  ──  CardSource ─────────────► api.github.com (binder-cards, token)   │
│     │                 │              └── LocalSource (dev only: ../binder-cards or fixtures)      │
│     │                 └── Cache API (card files) + IndexedDB (settings, token, LRU bookkeeping)   │
│     └── Renderer (WebGL2) ◄── textures + card.json                                                │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
           ▲ HTTPS (install + code updates only)
   https://<user>.github.io/binder-app/   ← GitHub Pages, built by GitHub Actions from the binder-app repo
```

Stack: **Vite + TypeScript (strict) + Preact**, raw **WebGL2**, `vite-plugin-pwa` (Workbox) for the app-shell
service worker. No other runtime dependencies without a good reason (ask first). No analytics, no external fonts,
no third-party requests except `api.github.com`.

Suggested source layout:

```
src/
  main.tsx, app.tsx           routing between screens (no router library needed)
  ui/                         screens and components (Italian strings in ui/strings.ts)
  data/source.ts              CardSource interface; github-source.ts; local-source.ts
  data/store.ts               index refresh, versions, downloads, cache, LRU, persistence
  render/                     gl.ts, shaders.ts, textures.ts, camera.ts, math.ts, renderer.ts
  interaction/                tilt.ts (device orientation), immersive.ts (playback), gestures.ts
  debug/                      overlay (?debug=1): fps, texture memory, chosen resolution, tilt zoom, errors
tests/                        vitest unit tests, Playwright (WebKit) fidelity tests, fixtures
```

## 4. Data source and access

### GitHubSource
- Config: owner, repo (`binder-cards`), branch (`main`), token. Owner/repo/branch are build-time constants
  (`VITE_CARDS_OWNER`, `VITE_CARDS_REPO`, `VITE_CARDS_BRANCH`); the token is entered by the user.
- File request: `GET https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}` with headers
  `Authorization: Bearer <token>`, `Accept: application/vnd.github.raw+json`, `X-GitHub-Api-Version: 2022-11-28`.
  Returns the raw bytes (supported up to 100 MB per file; our files are a few MB).
- Use `If-None-Match` with the stored ETag for `index.json`.
- Errors: 401 → key not valid / revoked (show the key screen); 404 → key without access to the repo, or wrong path;
  403/429 with rate-limit headers → "riprova più tardi"; network failure → offline mode with cached data.
- Rate limit: 5000 requests/hour per token owner, shared by all tokens: irrelevant for a few users, but never poll.
- **First thing to verify on a real iPhone (M3): CORS works from the installed app** (it is expected to).

### LocalSource (development only)
Reads the same structure from a local folder served by the Vite dev server: `tests/fixtures/cards-repo` by default,
or a sibling checkout `../binder-cards` when `VITE_LOCAL_CARDS=../binder-cards`. Never included in production builds.

### Token handling
- Entered once in the onboarding screen (paste), validated by fetching `index.json`, stored in IndexedDB.
- On iOS the Home Screen app has its own storage, separate from Safari: the key must be entered **inside the
  installed app**. The onboarding explains it.
- Settings: replace / remove the key.

## 5. Download, cache, offline, updates

Storage: **Cache API** for card files (keys like `/cards/<id>/<version>/<file>`), IndexedDB for settings,
token, ETags and LRU timestamps. Call `navigator.storage.persist()` after onboarding (WebKit decides with heuristics that include running as a
Home Screen web app; persistent storage is excluded from eviction). Show its result in the debug overlay.

- **At launch** (online): fetch `index.json`. For every card whose `version` changed, delete its cached files of
  the old version. Then prefetch the **base** files of every card (`card.json`, `thumb.webp`, `front.webp`,
  `artwork.webp`): the binder is fully browsable offline. Show "N carte nuove" if new ids appeared.
- **When a card is opened in Artwork mode**: show `artwork.webp` immediately, download the half layers
  (3D becomes available), then the full layers if this device needs them (CARD_FORMAT §5). Show progress discreetly.
- **Layer cache limit**: default 500 MB (setting: 250 MB / 500 MB / 1 GB / "tutto"). Evict least-recently-opened
  cards' layers first; base files are never evicted.
- Settings: space used (`navigator.storage.estimate()` + own bookkeeping), "Svuota cache 3D", "Scarica tutto per
  l'uso offline", "Controlla aggiornamenti".
- **Offline**: cards whose layers are not cached show the Carta and the flat artwork; the 3D button is disabled
  with the hint "Serve la connessione per scaricare il 3D".
- **App code updates**: vite-plugin-pwa with prompt mode; when a new version is available show
  "Nuova versione disponibile — tocca per aggiornare".

## 6. UI (Italian) and state machine

Portrait only. Respect safe areas (`viewport-fit=cover`, `env(safe-area-inset-*)`). No text selection, no callout
menu on long press (`-webkit-touch-callout: none; user-select: none`), `touch-action: manipulation`.
Simple, clean, card-collector feel; the cards are the protagonists. The visual design of the binder will be refined
later: keep the UI layer separate from data and rendering.

### Screens
1. **Benvenuto / installazione** — if not running standalone (`navigator.standalone !== true` and not
   `display-mode: standalone`): short illustrated steps "Condividi → Aggiungi alla schermata Home", then open the app
   from the icon.
2. **Chiave di accesso** — paste field, "Continua"; errors in plain Italian ("Chiave non valida", "Nessuna connessione").
3. **Raccoglitore** — grid of thumbnails ordered by `order`; small badge on cards with immersive; a cloud badge on
   cards whose 3D is not downloaded (when offline). Tap → card view.
4. **Carta** (card view), with a mode button **Carta / Artwork**:
   - *Carta*: `front.webp` (or the artwork if missing), fitted to the screen.
   - *Artwork*: the WebGL view in the card's aspect, rounded corners; button **3D** (on/off).
     With 3D off and an immersive card, a hint icon "Tieni premuto" is visible; long press starts the immersive.
   - Back to the binder with a back button / edge swipe. (Swipe between cards: later, optional.)
5. **Impostazioni** — cache, downloads, key, app version, debug toggle.

### Card view state machine

| State | Shows | Transitions |
|---|---|---|
| `card` | front image | mode button → `artwork-flat` |
| `artwork-flat` | home view (identical to the drawing) | mode → `card`; 3D → `artwork-tilt` (asks motion permission the first time); long press (immersive cards, full textures ready) → `immersive` |
| `artwork-tilt` | parallax following the phone | 3D → `artwork-flat` (0.35 s return to home) ; mode → `card` |
| `immersive` | approved camera flight | ends by itself → `artwork-flat`; leaving the card view stops it |

If motion permission is denied: keep 3D off and show "Per il 3D consenti l'accesso a movimento e orientamento" with
a retry. Leaving the card view releases GPU textures.

## 7. PWA details

- `manifest.webmanifest`: `name` "Raccoglitore", `display: standalone`, `orientation: portrait`, `scope`/`start_url`
  = the Pages base path (`/binder-app/`), icons 180/192/512 (placeholder until Davide provides artwork).
- `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, theme colour.
- Vite `base` = `/binder-app/` in production.
- Service worker precaches only the app shell; card data is managed by `data/store.ts`, never by Workbox runtime
  caching (to keep versions and LRU under our control).

## 8. Privacy and repository rules

- This repository may be public: **never commit real artwork, real card bundles or real reference frames**.
  Only the synthetic test cards in `tests/fixtures/` are allowed.
- The token must never be logged, sent anywhere except `api.github.com`, or embedded in the build.

## 9. Not in v1

Effects (sparkles, bloom), holographic foil, sound, swipe between cards, search/filters, sharing, iPad layout,
Android-specific work (it may work, it is not a target).
