/* ============================================================
   FOCYL — ASSET LIBRARY REGISTRY
   One declaration per library. Each has a manifest at
   /libraries/<id>/index.json that you fill in over time.

   Nothing here hardcodes content. Add a row to a manifest and
   it appears in the board sheet automatically — no code change.

   Read:   await FocylLibraries.load('ribbons')
   List:   FocylLibraries.all()
   Filter: await FocylLibraries.items('images', { category: 'yachts' })
   Gate:   FocylLibraries.canUse(item, userTier)
   ============================================================ */
(() => {
  const BASE = '/libraries';

  /* ---- TIERS -------------------------------------------------
     free   → Spark        (everyone)
     plus   → Press        (paid print tier)
     film   → Film         (premium live-screen tier)
     Every asset carries a tier. Default is 'free'.
  ------------------------------------------------------------ */
  const TIER_RANK = { free: 0, plus: 1, film: 2 };

  /* ---- REGISTRY ---------------------------------------------
     kind:       how the board renders it
     categories: the chips shown in the picker
     schema:     required fields per manifest entry
     status:     'live' | 'stub'  ← honest state of each library
  ------------------------------------------------------------ */
  const REGISTRY = {

    fonts: {
      label: 'Fonts',
      kind: 'typeface',
      status: 'live',
      description: 'Typefaces available to text tiles.',
      categories: ['display', 'serif', 'sans', 'script', 'mono', 'handwritten'],
      schema: ['id', 'name', 'stack', 'category', 'source', 'weights', 'license', 'tier'],
      note: 'source: "google" | "local" | "hosted". Self-host anything you ship to print — Google Fonts CDN is not print-license-safe for POD.'
    },

    templates: {
      label: 'Templates',
      kind: 'layout',
      status: 'stub',
      description: 'Pre-arranged board layouts a user can start from.',
      categories: ['grid', 'collage', 'timeline', 'quadrant', 'single-focus', 'yearly', 'quarterly'],
      schema: ['id', 'name', 'category', 'thumb', 'canvas', 'tiles', 'tier'],
      note: 'tiles[] is the same shape as a saved board. A template IS a board with no user_id. Build the exporter from board → template first; it makes authoring these near-free.'
    },

    borders_board: {
      label: 'Board Borders',
      kind: 'frame',
      status: 'stub',
      description: 'Frames that wrap the whole canvas — the outer edge of the vision board.',
      categories: ['minimal', 'ornate', 'gold-leaf', 'wood', 'neon', 'torn-paper', 'film-strip'],
      schema: ['id', 'name', 'category', 'asset', 'slice', 'thumb', 'tier'],
      note: 'Use CSS border-image with a 9-slice. "slice" is the inset in px. SVG or 2x PNG only — these get printed at 300dpi.'
    },

    borders_image: {
      label: 'Image Borders',
      kind: 'frame',
      status: 'stub',
      description: 'Frames applied to a single image tile.',
      categories: ['polaroid', 'photo-corner', 'thin-rule', 'deckled', 'vignette', 'tape-edge'],
      schema: ['id', 'name', 'category', 'asset', 'slice', 'padding', 'thumb', 'tier'],
      note: 'Polaroid needs a caption slot — reserve bottom padding in the manifest, not in CSS.'
    },

    ribbons: {
      label: 'Ribbons',
      kind: 'overlay',
      status: 'stub',
      description: 'Banners and sashes for labelling a goal or a date.',
      categories: ['banner', 'sash', 'award', 'bookmark', 'pennant'],
      schema: ['id', 'name', 'category', 'asset', 'textBox', 'thumb', 'tier'],
      note: 'textBox is {x,y,w,h,rotate,align} in the ribbon\'s own coordinate space — that is what makes a ribbon fillable instead of a flat sticker.'
    },

    images: {
      label: 'Images',
      kind: 'photo',
      status: 'live',
      description: 'The curated photo set behind the category chips.',
      categories: [
        'mansions', 'cars', 'beaches', 'yachts', 'jets', 'designer-logos',
        'travel', 'fitness', 'family', 'career', 'wealth', 'wellness'
      ],
      schema: ['id', 'category', 'thumb', 'full', 'w', 'h', 'credit', 'license', 'tier'],
      note: 'LEGAL: "designer-logos" cannot ship as a stock category. Trademarks are not licensable for resale on a printed product. Replace with "luxury-details" (unbranded texture, hardware, stitching) or make it user-upload only, never a Focyl-supplied asset.'
    },

    papers: {
      label: 'Papers',
      kind: 'surface',
      status: 'stub',
      description: 'Writable paper surfaces for text tiles.',
      categories: ['lined', 'grid', 'dotted', 'scroll', 'parchment', 'ledger', 'graph', 'legal-pad'],
      schema: ['id', 'name', 'category', 'asset', 'tileable', 'lineHeight', 'inkColor', 'thumb', 'tier'],
      note: 'lineHeight must match the text tile line-height or writing floats off the rules. Store it and let the text tile read it.'
    },

    canvases: {
      label: 'Canvases',
      kind: 'background',
      status: 'stub',
      description: 'The board substrate — what everything sits on.',
      categories: ['solid', 'gradient', 'linen', 'cork', 'concrete', 'velvet', 'midnight', 'seasonal'],
      schema: ['id', 'name', 'category', 'asset', 'fill', 'tileable', 'printSafe', 'thumb', 'tier'],
      note: 'printSafe flags whether it survives CMYK. Dark gradients that look right on OLED go muddy on paper — flag them and warn at checkout.'
    },

    notes: {
      label: 'Sticky Notes',
      kind: 'surface',
      status: 'stub',
      description: 'Post-it style notes for quick capture on the board.',
      categories: ['square', 'lined', 'tab', 'torn', 'index-card', 'flag'],
      schema: ['id', 'name', 'category', 'color', 'asset', 'shadow', 'maxChars', 'thumb', 'tier'],
      note: 'maxChars keeps a note a note. If it overflows it should become a text tile, not a scrolling box.'
    }
  };

  /* ---- LOADER ------------------------------------------------ */
  const cache = new Map();

  async function load(id) {
    if (!REGISTRY[id]) throw new Error(`Unknown library: ${id}`);
    if (cache.has(id)) return cache.get(id);
    try {
      const res = await fetch(`${BASE}/${id}/index.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const manifest = await res.json();
      const merged = { ...REGISTRY[id], id, items: manifest.items || [], version: manifest.version || 0 };
      cache.set(id, merged);
      return merged;
    } catch (e) {
      // An unfilled library is not an error — it is just empty.
      const empty = { ...REGISTRY[id], id, items: [], version: 0, empty: true };
      cache.set(id, empty);
      return empty;
    }
  }

  async function items(id, filter = {}) {
    const lib = await load(id);
    return lib.items.filter(it =>
      (!filter.category || it.category === filter.category) &&
      (!filter.tier || TIER_RANK[it.tier || 'free'] <= TIER_RANK[filter.tier]) &&
      (!filter.q || (it.name || '').toLowerCase().includes(filter.q.toLowerCase()))
    );
  }

  function canUse(item, userTier = 'free') {
    return TIER_RANK[item.tier || 'free'] <= TIER_RANK[userTier || 'free'];
  }

  function all() {
    return Object.entries(REGISTRY).map(([id, v]) => ({ id, ...v }));
  }

  function assetUrl(libId, file) {
    return `${BASE}/${libId}/${file}`;
  }

  window.FocylLibraries = { load, items, all, canUse, assetUrl, REGISTRY, TIER_RANK };
})();
