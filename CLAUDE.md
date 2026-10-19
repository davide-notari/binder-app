# CLAUDE.md — instructions for Claude Code

## Project
"Raccoglitore": a private PWA binder of custom Pokémon cards (painted by Davide for his brother's wedding).
Cards are shown as the full card or as a 2.5D artwork (tilt parallax, optional immersive camera flight),
rendered in real time with WebGL2 from layers produced by a separate pipeline.

Read before doing anything, in this order:
1. `docs/SPEC.md` — product, decisions, architecture, data access, cache, UI and state machine
2. `docs/CARD_FORMAT.md` — the data contract (`index.json`, `card.json`, textures, camera track)
3. `docs/RENDERING.md` — renderer rules, tilt, immersive, fidelity tests
4. `docs/ROADMAP.md` — milestones and acceptance criteria. Work one milestone at a time.

## Working with Davide
- Talk to Davide in **Italian**: clear, practical, no jargon without explanation. He is an experienced developer
  (C#/.NET, some iOS), new to this web stack.
- Code, identifiers, file names, JSON keys, comments, commit messages: **English**. UI strings: **Italian**
  (all in `src/ui/strings.ts`).
- At the end of every milestone: what you did, how you verified it, what he must check on the iPhone (step by step),
  open risks. Never claim something works on iPhone if it was only tested in desktop WebKit.
- Decisions listed in SPEC.md §2 are settled. If something there turns out to be impossible, stop and explain.
- Ask before adding a runtime dependency.

## Non-negotiable rules
- **Quality first.** The artwork must look exactly like the approved preview frames. Follow RENDERING.md literally:
  premultiplied alpha, no linear colour space, mipmaps + anisotropy, projective texture coordinates divided in the
  fragment shader. The fidelity test (RENDERING.md §8) must stay green; never loosen its thresholds to make it pass.
- **Privacy.** This repo may be public. Never commit real artwork, real `.card` bundles or real reference frames
  (only `tests/fixtures/` synthetic data). Never log or persist the token anywhere except IndexedDB; never send it
  anywhere except `api.github.com`.
- The data format is defined by `binder-cards/tools/export_card.py`. Do not change the format on the app side; if the
  app needs more data, write down the proposed change for Davide (it will be added to the exporter, then the schema
  version bumps).
- Layers are static: only the camera moves.
- Target: iOS 17+ Safari, Home Screen web app, any iPhone size, portrait. Test in Playwright WebKit and ask Davide for
  real-device checks.

## Repositories on Davide's machine
```
<parent>/binder-app     this repository (code; deployed to GitHub Pages)
<parent>/binder-cards   private card data repository (do not modify it from here, except reading for local tests)
```
Local development reads cards from `tests/fixtures/cards-repo` (default) or from `../binder-cards`
(`VITE_LOCAL_CARDS=../binder-cards` in `.env.local`, which is git-ignored).

## Commands
```
npm ci                          install exact dependency versions (package-lock.json)
npx playwright install webkit   one-time: WebKit browser for the Playwright tests
npm run dev                     dev server on http://localhost:5173 (cards under /dev-cards/)
npm run build                   type check (tsc -b) + production build into dist/ (base /binder-app/)
npm run preview                 serve dist/ at http://localhost:4173/binder-app/
npm run typecheck               TypeScript only
npm run lint                    ESLint (type-checked rules)
npm run format / format:check   Prettier write / check
npm test                        unit tests + WebKit tests
npm run test:unit               Vitest (tests/unit)
npm run test:e2e                Playwright WebKit, iPhone 15 profile (tests/e2e; own dev server on port 5174)
CARDS_DIR=../binder-cards npm run test:e2e   same tests on the real cards (local only, nothing copied)
FIDELITY_SAVE=1 npx playwright test tests/e2e/fidelity.spec.ts   also save side-by-side + heatmap of passing frames
python3 tools/make_premultiply_fixture.py   regenerate src/dev/premultiply-fixture.ts (needs pillow, numpy)
```
- WebKit tests: fidelity (RENDERING.md §8, every reference frame of every card with `refs/`), premultiplied
  upload, context loss/restore, smoke. Comparison images go to `test-results/` (git-ignored, wiped every run).
- Dev pages (dev server only): `/?dev=render&card=<id>&t=<sec>[&res=half][&w=<px>&h=<px>][&ui=0]` renders a card
  (tap: hide/show panel, press and hold: reference frame); `/?dev=premultiply` checks the premultiplied upload.
- Renderer sampling follows RENDERING.md §2a (reference pyramid + OpenCV bicubic + half-pixel grid).
- Dev cards: `tests/fixtures/cards-repo` by default; `VITE_LOCAL_CARDS=../binder-cards` in `.env.local` for the
  real cards. The `/dev-cards/` middleware (`tools/dev-cards.ts`) exists only in the dev server.
- iPhone during development: `npm run dev`, then `cloudflared tunnel --url http://localhost:5173`.
- Deploy: every push to `main` runs `.github/workflows/deploy-pages.yml` (lint, format check, unit tests, build)
  and publishes https://davide-notari.github.io/binder-app/. Watch it with `gh run watch`.
