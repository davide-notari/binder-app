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
(fill in during M0: dev server, build, unit tests, fidelity tests, lint)
