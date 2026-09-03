/* ============================================================
   FOCYL — IMAGE SEARCH (dual source)

   Openverse  — no API key. Called straight from the browser, so rate
                limits are per-user-IP rather than one shared bucket.
                Routing this through a proxy would put every user
                behind Supabase's IPs and cap the whole product at a
                few hundred people. CC0 results are print-safe.

   Pexels     — needs a key, so it goes through an Edge Function.
                The look the aspirational categories need, but the
                licence does not cover reselling a photo on a printed
                product. Those tiles are marked screen-only.

   Both normalise to the same shape, so the picker never branches.
   ============================================================ */
(() => {
  const OPENVERSE = 'https://api.openverse.org/v1/images/';
  const PRINT_MIN = 2400;

  // Recipes come from libraries/images/index.json so the rules can be
  // tuned without touching code. Loaded once, cached.
  let RECIPES = null;
  async function recipes() {
    if (RECIPES) return RECIPES;
    try {
      const lib = await FocylLibraries.load('images');
      RECIPES = lib.recipes || {};
    } catch (_) { RECIPES = {}; }
    return RECIPES;
  }

  const ASPIRATIONAL = new Set([
    'mansions', 'cars', 'yachts', 'jets', 'wealth', 'career', 'designer-logos'
  ]);

  // ============================================================
  //  RELEVANCE FILTER
  //  A search for "luxury yacht" returns tugboats, museum pieces and
  //  19th-century engravings because the provider matches loosely on
  //  one word. Every result is checked against the category's own
  //  must/exclude lists before it is allowed on screen.
  // ============================================================
  function haystack(r) {
    return [r.title, r.credit, (r.tags || []).join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function passes(r, recipe) {
    if (!recipe) return true;
    const text = haystack(r);

    // Any excluded word disqualifies outright.
    if ((recipe.exclude || []).some(w => text.includes(w))) return false;

    // Resolution floor: below this it looks like a snapshot, not a
    // vision board image.
    if (recipe.minWidth && r.w && r.w < recipe.minWidth) return false;

    // Must-match is only enforced when there is text to match against.
    // Pexels alt text is often empty, and rejecting those would empty
    // the grid for exactly the categories that need it most.
    const must = recipe.must || [];
    if (must.length && text.trim().length > 12) {
      return must.some(w => text.includes(w));
    }
    return true;
  }

  const norm = {
    openverse(r) {
      const w = r.width || 0, h = r.height || 0;
      const cc0 = ['cc0', 'pdm'].includes((r.license || '').toLowerCase());
      return {
        id: 'ov_' + r.id,
        provider: 'openverse',
        thumb: r.thumbnail || r.url,
        url: r.url,
        w, h,
        title: r.title || '',
        tags: (r.tags || []).map(t => t.name || t).filter(Boolean),
        credit: r.creator || 'Unknown',
        creditUrl: r.creator_url || r.foreign_landing_url || null,
        license: (r.license || '').toUpperCase() + (r.license_version ? ' ' + r.license_version : ''),
        // CC0/public domain can go on a product. Attribution licences
        // can too, but only with the credit line carried through.
        printSafe: Math.min(w, h) >= PRINT_MIN,
        commercialSafe: cc0,
        attributionRequired: !cc0
      };
    },
    pexels(r) {
      const w = r.width || 0, h = r.height || 0;
      return {
        id: 'px_' + r.id,
        provider: 'pexels',
        thumb: r.src?.medium || r.src?.small,
        url: r.src?.original || r.src?.large2x,
        w, h,
        title: r.alt || '',
        tags: [],
        credit: r.photographer || 'Pexels',
        creditUrl: r.photographer_url || null,
        license: 'Pexels',
        // Screen use is fine. Selling it printed is not.
        printSafe: false,
        commercialSafe: false,
        attributionRequired: false,
        screenOnly: true
      };
    }
  };

  async function searchOpenverse(q, { perPage = 12, cc0Only = false, minWidth = 0 } = {}) {
    const p = new URLSearchParams({
      q,
      page_size: String(Math.min(perPage, 20)),
      mature: 'false'
    });
    if (cc0Only) p.set('license', 'cc0,pdm');
    const res = await fetch(`${OPENVERSE}?${p}`, {
      headers: { Accept: 'application/json' }
    });
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error('Openverse ' + res.status);
    const data = await res.json();
    return (data.results || [])
      .map(norm.openverse)
      .filter(r => r.w >= minWidth);
  }

  async function searchPexels(q, { perPage = 12 } = {}) {
    const fn = window.FOCYL_CONFIG?.fn?.photoSearch;
    if (!fn) return [];
    const base = window.FOCYL_CONFIG.supabaseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}${fn}?q=${encodeURIComponent(q)}&per_page=${perPage}`, {
      headers: { Authorization: `Bearer ${window.FOCYL_CONFIG.supabaseAnonKey}` }
    });
    if (!res.ok) return [];                   // proxy down: Openverse still works
    const data = await res.json();
    return (data.photos || []).map(norm.pexels);
  }

  /* ============================================================
     search — runs both, interleaves, dedupes.
     Aspirational categories lead with Pexels because CC coverage
     there is documentary. Everything else leads with Openverse,
     which is both higher resolution and print-licensable.
     ============================================================ */
  async function search(query, opts = {}) {
    const all = await recipes();
    const recipe = all[opts.category] || null;
    const printMode = !!opts.printMode;

    // The recipe decides which providers may answer. Openverse simply
    // cannot deliver "exclusive and exotic" for yachts, cars, jets or
    // mansions — its catalogue is documentary. Those categories are
    // Pexels-only rather than being padded with irrelevant results.
    const allowed = recipe?.sources || ['openverse', 'pexels'];
    const q = recipe?.query || query;
    const perPage = opts.perPage || 12;

    // Over-fetch, because filtering discards a lot.
    const fetchN = Math.min(40, perPage * 3);

    const jobs = [];
    if (allowed.includes('openverse')) {
      jobs.push(searchOpenverse(q, {
        perPage: fetchN,
        cc0Only: printMode,
        minWidth: printMode ? PRINT_MIN : (recipe?.minWidth || 0)
      }));
    } else jobs.push(Promise.resolve([]));

    if (allowed.includes('pexels') && !printMode) {
      jobs.push(searchPexels(q, { perPage: fetchN }));
    } else jobs.push(Promise.resolve([]));

    const settled = await Promise.allSettled(jobs);
    const [ov, px] = settled.map(s => s.status === 'fulfilled' ? s.value : []);

    // Filter each source against the recipe.
    const fOv = (ov || []).filter(r => passes(r, recipe));
    const fPx = (px || []).filter(r => passes(r, recipe));

    // If a recipe is too strict and empties the grid, fall back to the
    // unfiltered set rather than showing the user nothing.
    const ovFinal = fOv.length ? fOv : (recipe && allowed.includes('openverse') ? [] : ov || []);
    const pxFinal = fPx.length ? fPx : (px || []).slice(0, perPage);

    const leadPexels = allowed[0] === 'pexels' || ASPIRATIONAL.has(opts.category);
    const a = leadPexels ? pxFinal : ovFinal;
    const b = leadPexels ? ovFinal : pxFinal;

    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) out.push(a[i]);
      if (b[i]) out.push(b[i]);
    }

    const seen = new Set();
    const deduped = out
      .filter(r => r.url && !seen.has(r.url) && seen.add(r.url))
      .slice(0, perPage);

    // A category the recipe restricts to Pexels is empty when the
    // proxy is not deployed. Say that, rather than "nothing found".
    const needsPexels = allowed.length === 1 && allowed[0] === 'pexels';
    const pexelsDown = needsPexels && !(px || []).length;

    return {
      results: deduped,
      rateLimited: settled.some(s => s.status === 'rejected' && s.reason?.message === 'RATE_LIMIT'),
      pexelsDown,
      printMode,
      printable: recipe ? recipe.printable !== false : true,
      note: recipe?.note || null
    };
  }

  window.FocylImages = { search, searchOpenverse, searchPexels, recipes, passes, ASPIRATIONAL, PRINT_MIN };
})();
