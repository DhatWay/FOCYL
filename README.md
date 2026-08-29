# FOCYL

Your future, in focus.

## What changed in this drop

```
FOCYL/
├── index.html          patched — logo is now one tag
├── auth.html           patched — FIXED the placeholder anon key that broke sign-in
├── board.html          patched — logo + shared config
├── manifest.json       fixed icon sizes and scope
├── sw.js               rewritten: network-first for pages, cleans old caches
├── assets/
│   ├── focyl-mark.svg      the aperture mark, one file
│   ├── focyl-logo-128.png  extracted from the inline base64
│   ├── icon-192.png        actually 192px now
│   └── icon-512.png
├── lib/
│   ├── focyl-config.js     one place for credentials
│   ├── focyl-brand.js      <focyl-mark> — replaces every copy of the logo
│   └── focyl-libraries.js  the nine asset libraries
├── libraries/          one folder per library, each with index.json
└── db/schema.sql       tables + Row Level Security (run this first)
```

`config.js` was deleted. It was never loaded by any page.

## Do this first

1. Open Supabase → SQL Editor → paste `db/schema.sql` → run.
   Until you do, the anon key lets any visitor read and delete every board.
2. Delete the bypass button in `auth.html` before this is public.
3. Deploy. Bump `CACHE` in `sw.js` on every deploy or returning visitors keep the old build.

## The logo

Anywhere you want the mark:

```html
<focyl-mark></focyl-mark>                      <!-- 32px -->
<focyl-mark size="150" animate></focyl-mark>   <!-- blades converge on load -->
<focyl-mark size="30" link></focyl-mark>       <!-- clickable, goes to index -->
<focyl-mark size="56" variant="press"></focyl-mark>
```

Recolour without touching the file:

```css
focyl-mark { --focyl-c1:#F5A524; --focyl-c2:#8B7CF6; --focyl-c3:#35D8F0; }
```

## Filling a library

Every library is a folder with an `index.json` and an `assets/` directory.
Drop files in `assets/`, add a row to `items[]`, done — no code change.

```json
{
  "library": "ribbons",
  "version": 2,
  "categories": ["banner", "sash", "award", "bookmark", "pennant"],
  "items": [
    {
      "id": "gold-banner-01",
      "name": "Gold Banner",
      "category": "banner",
      "asset": "assets/gold-banner-01.svg",
      "textBox": { "x": 40, "y": 28, "w": 220, "h": 44, "rotate": 0, "align": "center" },
      "thumb": "assets/gold-banner-01-thumb.webp",
      "tier": "free"
    }
  ]
}
```

Required fields per library are declared in `lib/focyl-libraries.js` under `schema`.
Bump `version` when you add items so the service worker refetches.

Read them in the app:

```js
const ribbons = await FocylLibraries.items('ribbons', { category: 'banner', tier: userTier });
```

## One legal note

`libraries/images/` has a `designer-logos` category, carried over from the
category chips in the board sheet. Trademarks are not licensable for resale on
a printed product — that category cannot ship as Focyl-supplied stock. Either
rename it to unbranded `luxury-details`, or make it user-upload only.

---

## Fixes applied in this drop

| | Was | Now |
|---|---|---|
| **Sign-in** | placeholder anon key — every login failed | reads `FOCYL_CONFIG` |
| **Save** | `delete()` all tiles then `insert()` | debounced `upsert` on primary key; deletes only removed ids |
| **Tile ids** | Postgres minted new UUIDs each save | client UUID is the primary key, stable across reloads |
| **Text tiles** | saved on every keystroke | 800ms debounce, coalesced writes |
| **Drag at zoom** | tile ran away from your finger | pointer delta divided by `scale` |
| **Canvas size** | restore ran before `loadBoard()` resolved | `restoreCanvasSize()` called after the await |
| **Autosave** | wrote every 30s even when idle | only writes when something changed |
| **Unload save** | `beforeunload` + async — never completed | `visibilitychange` while page is alive |
| **Delete tile** | instant, no confirm, leaked `<audio>` | confirms, pauses audio, records id for deletion |
| **Bypass button** | live in production | hidden unless `FOCYL_CONFIG.devBypass` |
| **Debug panel** | always visible | `?debug=1` |
| **Logo** | 5 copies, 49KB of source | one `<focyl-mark>` tag |

## Library picker

Papers and Ribbons are wired end to end as proof of the pattern — two new
tabs in the board sheet, populated at runtime from their `index.json`.
Three paper surfaces and two ribbons ship as working SVGs.

Mounting a third library is one call:

```js
FocylPicker.mount('#panelNotes', 'notes', {
  tier,
  onPick: item => addTile({ type: 'note', library_id: item.library_id, ... })
});
```

An unfilled library is not an error — the picker renders a placeholder
pointing at the manifest path to fill.
