# Proposal: expansions (card sets) — format change for `export_card.py`

Status: **proposal**, waiting for Davide's answers (end of this page). Nothing here is implemented yet.
Per CLAUDE.md the data format is defined by the exporter: this page describes what the app needs, to be added to
`binder-cards/tools/export_card.py` (Claude project "Carte"), after which `schema` becomes 2.

## Why

Davide will paint new cards in different expansions. The app opens on a **collection** screen that shows every
expansion with a cover image; tapping one opens its binder (today's binder screen). The current expansion is
**Unione Eterna**.

## What the app needs

Per expansion: an id, a display name, a display order and a cover image. Per card: the expansion it belongs to.

### `index.json` (schema 2)

```json
{
  "schema": 2,
  "sets": [
    {
      "id": "unione-eterna",              // [a-z0-9-]
      "name": "Unione Eterna",            // display name (Italian UI)
      "order": 1,                         // display order in the collection (ascending; decimals allowed)
      "cover": "sets/unione-eterna/cover.webp",
      "coverSize": [1200, 1600],          // [w, h] px
      "version": "3f2a9c1d0b7e"           // content hash of name + cover: changes when either changes
    }
  ],
  "sections": ["promo", "main"],
  "cards": [
    { "id": "kc-236-celebi", "set": "unione-eterna", "...": "unchanged fields" }
  ]
}
```

- `cards[].set` must be the id of an entry of `sets` (the exporter refuses anything else).
- Sections (promo / main) and `order` keep their meaning **inside** each expansion.
- `cards` sorted by set order, then section, then `order`, then `id` (the app does not rely on it).

### `card.json`

One new top-level key, `"set": "unione-eterna"` (same value as in the index).

### Repository layout (`binder-cards`)

```
sets/<set-id>/cover.webp     cover image, lossy WebP q92, ≤ 1200 px wide, portrait 3:4 recommended (1200×1600)
```

## Exporter changes

1. **New tool** `tools/export_set.py` (+ launchers `esporta_espansione_mac.command` / `_windows.bat`):
   `--id unione-eterna --name "Unione Eterna" --order 1 --cover <image>` → writes `sets/<id>/cover.webp`, adds or
   updates the entry in `index.json` `sets` (version = hash of name + cover bytes). Re-running it with the same id
   updates the name, order or cover.
2. **`export_card.py`**: new option `--set <id>` (asked interactively by the launcher like the other questions;
   default: the expansion this card id had in the last export, otherwise the only expansion if there is just one).
   It must exist in `index.json` `sets`. Writes `set` into `card.json` and the index entry.
3. `SCHEMA = 2`; `verify_card.py` unchanged (geometry and textures do not change).
4. **Migration of the 4 current cards**: run `export_set.py` once for Unione Eterna, then re-export the 4 cards with
   `--set unione-eterna` (their versions change, the app re-downloads them once).

## App changes (after the exporter)

- Accept schema 1 **and** 2 during the transition: the app update ships first, then the new data is pushed.
  A schema-1 index is shown as a single expansion without cover.
- New **collection** screen (home): one tile per expansion with cover, name and number of cards ("4 carte"),
  "N carte nuove" badge on the tile when new cards arrive. Tap → binder of that expansion (title = expansion name,
  back to the collection with the same edge swipe as the card view).
- Swiping between cards stays inside the expansion. Settings unchanged ("Scarica tutto" covers every expansion).
- Covers are cached like the other base files (offline), versioned by `sets[].version`.
- Tests: fixture repository with two synthetic expansions and covers.

## Questions for Davide

1. **Cover**: what image will it be (a dedicated illustration, a crop of a card artwork, a logo on a background)?
   Is portrait 3:4 fine, or do you prefer another shape (e.g. square, or wide like a banner)?
2. **Promo cards**: do they belong to an expansion (shown on top of its binder, as now), or should all promos live
   in their own "Promo" entry of the collection?
3. **Order**: expansions oldest first or newest first?
4. **Tile content**: besides cover, name and card count, anything else (year, an expansion symbol)?
5. With a single expansion today, should the app still open on the collection (consistent, ready for the future),
   or go straight into Unione Eterna until a second one exists? (Proposal: always the collection.)
