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

  // Categories where documentary CC photography reads as encyclopedic
  // rather than aspirational. These lead with Pexels when it is available.
  const ASPIRATIONAL = new Set([
    'mansions', 'cars', 'yachts', 'jets', 'wealth', 'career', 'designer-logos'
  ]);

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
    const leadPexels = ASPIRATIONAL.has(opts.category);
    const printMode = !!opts.printMode;

    // Print mode is CC0-only: nothing else can legally reach a printer.
    const jobs = printMode
      ? [searchOpenverse(query, { ...opts, cc0Only: true, minWidth: PRINT_MIN })]
      : [searchOpenverse(query, opts), searchPexels(query, opts)];

    const settled = await Promise.allSettled(jobs);
    const [ov, px] = settled.map(s => s.status === 'fulfilled' ? s.value : []);

    const a = leadPexels ? (px || []) : ov;
    const b = leadPexels ? ov : (px || []);

    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) out.push(a[i]);
      if (b[i]) out.push(b[i]);
    }

    const seen = new Set();
    const deduped = out.filter(r => !seen.has(r.url) && seen.add(r.url));

    const rateLimited = settled.some(s =>
      s.status === 'rejected' && s.reason?.message === 'RATE_LIMIT');

    return { results: deduped, rateLimited, printMode };
  }

  window.FocylImages = { search, searchOpenverse, searchPexels, ASPIRATIONAL, PRINT_MIN };
})();
