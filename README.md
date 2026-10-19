# Raccoglitore (binder-app)

Private Progressive Web App that shows Davide's custom Pokémon cards: full card view and 2.5D artwork with tilt
parallax and immersive camera flights, rendered in real time with WebGL2.

- Card data lives in the private repository `binder-cards` and is downloaded with a personal access key.
- Documentation: `docs/SPEC.md`, `docs/CARD_FORMAT.md`, `docs/RENDERING.md`, `docs/ROADMAP.md`.
- Instructions for AI-assisted development: `CLAUDE.md`.
- `tests/fixtures/cards-repo/` contains synthetic test cards only (no real artwork).

## Development

Requirements: Node.js 22 or later, Git.

```
npm ci
npx playwright install webkit
npm run dev        # http://localhost:5173
npm test           # unit tests + WebKit tests
npm run build      # production build in dist/
```

The dev server reads the synthetic cards in `tests/fixtures/cards-repo`. To use a local checkout of the private
cards repository instead, create `.env.local` (git-ignored) with `VITE_LOCAL_CARDS=../binder-cards`.

Every push to `main` is built and published to GitHub Pages by `.github/workflows/deploy-pages.yml`:
https://davide-notari.github.io/binder-app/
