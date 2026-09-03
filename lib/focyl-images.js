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

  // ============================================================
  //  SCORE
  //  passes() only answered yes/no, so a weak match could sit above
  //  a perfect one. Scoring lets the best results rise instead.
  // ============================================================
  function score(r, recipe) {
    if (!recipe) return 0;
    const text = haystack(r);
    let n = 0;
    (recipe.must   || []).forEach(w => { if (text.includes(w)) n += 2; });
    (recipe.prefer || []).forEach(w => { if (text.includes(w)) n += 3; });

    // Resolution above the floor is worth something, but capped so a
    // huge irrelevant image never outranks a relevant one.
    if (r.w >= 3000) n += 2; else if (r.w >= 2000) n += 1;

    // Portrait suits a vision board tile; extreme panoramas do not.
    const ratio = r.w && r.h ? r.w / r.h : 1;
    if (recipe.orientation === 'portrait' && ratio < 1) n += 2;
    if (recipe.orientation === 'landscape' && ratio > 1.2) n += 1;

    if (r.provider === 'pexels') n += 1;   // curated, so cleaner on average
    return n;
  }

  function passes(r, recipe) {
    if (!recipe) return true;
    const text = haystack(r);

    // Any excluded word disqualifies outright.
    if ((recipe.exclude || []).some(w => text.includes(w))) return false;

    // Resolution floor: below this it looks like a snapshot, not a
    // vision board image.
    if (recipe.minWidth && r.w && r.w < recipe.minWidth) return false;

    // Aspect bounds. Panoramas and letterbox crops read as stock
    // filler on a board, whatever their subject.
    if (recipe.ratio && r.w && r.h) {
      const ar = r.w / r.h;
      if (ar < recipe.ratio[0] || ar > recipe.ratio[1]) return false;
    }

    // Anything the user has hidden for this category, permanently.
    if (recipe._blocked && recipe._blocked.some(w => text.includes(w))) return false;

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

  async function searchPexels(q, { perPage = 12, orientation, size } = {}) {
    const fn = window.FOCYL_CONFIG?.fn?.photoSearch;
    if (!fn) return [];
    const base = window.FOCYL_CONFIG.supabaseUrl.replace(/\/$/, '');
    const p = new URLSearchParams({ q, per_page: String(perPage) });
    if (orientation) p.set('orientation', orientation);
    if (size) p.set('size', size);
    const res = await fetch(`${base}${fn}?${p}`, {
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
  // Results are stable for a session; refetching the same category
  // wastes quota and shows the user the same grid anyway.
  const cache = new Map();
  const CACHE_TTL = 1000 * 60 * 20;

  async function search(query, opts = {}) {
    const all = await recipes();
    const recipe = all[opts.category] ? { ...all[opts.category] } : null;
    const printMode = !!opts.printMode;
    const perPage = opts.perPage || 12;

    if (recipe) {
      const lib = await FocylLibraries.load('images');
      recipe._blocked = (lib.blocklist || {})[opts.category] || [];
      if (opts.userQuery) recipe.must = [];   // trust what they typed
    }

    const cacheKey = `${opts.userQuery ? 'q:' + query : opts.category || query}:${printMode}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL && !opts.fresh) {
      return hit.data;
    }

    const allowed = recipe?.sources || ['openverse', 'pexels'];

    // Three distinct queries instead of one broad one. A single query
    // returns one narrow slice of a provider's catalogue; three
    // different phrasings surface genuinely different photographs and
    // give the scorer more to choose between.
    // The user's own words take priority. Recipe queries are only used
    // when browsing a category, never to override something typed.
    const queries = opts.userQuery
      ? [query]
      : recipe
        ? [recipe.query, ...(recipe.alt || [])].slice(0, 3)
        : [query];

    const jobs = [];
    queries.forEach(q => {
      if (allowed.includes('openverse')) {
        jobs.push(searchOpenverse(q, {
          perPage: 20,
          cc0Only: printMode,
          minWidth: printMode ? PRINT_MIN : (recipe?.minWidth || 0)
        }).catch(() => []));
      }
      if (allowed.includes('pexels') && !printMode) {
        jobs.push(searchPexels(q, {
          perPage: 24,
          orientation: recipe?.orientation,
          size: 'large'
        }).catch(() => []));
      }
    });

    const settled = await Promise.allSettled(jobs);
    const pool = [];
    settled.forEach(s => { if (s.status === 'fulfilled') pool.push(...s.value); });

    const pexelsCount = pool.filter(r => r.provider === 'pexels').length;

    // Filter, then rank.
    let kept = pool.filter(r => r.url && passes(r, recipe));
    kept.forEach(r => { r._score = score(r, recipe); });
    kept.sort((a, b) => b._score - a._score);

    // One shoot can flood the grid — Pexels often returns six frames
    // of the same subject by the same photographer. Cap it so the
    // category looks varied rather than repetitive.
    const byCreator = new Map();
    const varied = [];
    for (const r of kept) {
      const k = (r.credit || '').toLowerCase();
      const n = byCreator.get(k) || 0;
      if (n >= 2) continue;
      byCreator.set(k, n + 1);
      varied.push(r);
    }

    const seen = new Set();
    const deduped = varied
      .filter(r => !seen.has(r.url) && seen.add(r.url))
      .slice(0, perPage);

    const needsPexels = allowed.length === 1 && allowed[0] === 'pexels';
    const data = {
      results: deduped,
      rateLimited: settled.some(s => s.status === 'rejected' && s.reason?.message === 'RATE_LIMIT'),
      pexelsDown: needsPexels && pexelsCount === 0,
      printMode,
      printable: recipe ? recipe.printable !== false : true,
      note: recipe?.note || null,
      inspected: pool.length,
      kept: deduped.length
    };

    cache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  // Hide an image permanently: its distinctive words join the
  // category blocklist, so the same kind of result stops appearing.
  async function hide(result, category) {
    const lib = await FocylLibraries.load('images');
    lib.blocklist = lib.blocklist || {};
    lib.blocklist[category] = lib.blocklist[category] || [];
    const words = (result.title || '').toLowerCase()
      .split(/[^a-z]+/).filter(w => w.length > 4).slice(0, 2);
    words.forEach(w => {
      if (!lib.blocklist[category].includes(w)) lib.blocklist[category].push(w);
    });
    try {
      localStorage.setItem('focyl_blocklist', JSON.stringify(lib.blocklist));
    } catch (_) {}
    cache.clear();
    return words;
  }

  // Restore any blocklist the user built in a previous session.
  (async () => {
    try {
      const saved = JSON.parse(localStorage.getItem('focyl_blocklist') || 'null');
      if (!saved) return;
      const lib = await FocylLibraries.load('images');
      lib.blocklist = { ...(lib.blocklist || {}), ...saved };
    } catch (_) {}
  })();

  window.FocylImages = { search, searchOpenverse, searchPexels, recipes, passes, score, hide, ASPIRATIONAL, PRINT_MIN };
})();
