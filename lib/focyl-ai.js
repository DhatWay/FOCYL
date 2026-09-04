/* ============================================================
   FOCYL — AI

   Talks to the ai-image Edge Function, cleans up the result, puts
   it in Storage, and indexes it in generated_assets so it becomes
   part of your own library rather than a one-off.

   Keys live in Supabase secrets. Nothing here holds one.
   ============================================================ */
(() => {
  /* ---- INTENTS -------------------------------------------------
     A vision board needs more than photographs. Each intent shapes
     the prompt differently and decides whether the result needs its
     background knocked out.
  --------------------------------------------------------------- */
  const INTENTS = {
    photo: {
      label: 'Photo',
      suffix: 'photorealistic editorial photograph, dramatic natural light, ' +
              'shallow depth of field, aspirational, cinematic colour grading, no text',
      transparent: false, trim: false, aspect: '4:3'
    },

    // ---- Board assets ----
    // These must come back as ISOLATED OBJECTS, not photographs of an
    // object sitting somewhere. Without the negative scene wording an
    // image model returns a banner on a wall, a note on a desk, a
    // sheet of paper on a table — all unusable as tiles.
    lettering: {
      label: 'Lettering',
      takesText: true,
      build: (t, d) => `The word "${t}" written as ornate decorative lettering. ` +
        `${d || 'elegant gold calligraphy'}. ` +
        'Flat graphic design asset, isolated on a plain pure white background. ' +
        'The lettering fills the frame edge to edge. ' +
        'No scene, no environment, no wall, no paper, no desk, no shadow, ' +
        'no frame, no border, no background objects. Sharp clean edges.',
      transparent: true, trim: true, aspect: '16:9', needsText: true
    },
    ribbon: {
      label: 'Ribbon',
      takesText: true,
      build: (t, d) => `A single decorative ribbon banner` +
        (t ? ` with the text "${t}" written clearly across it` : '') + '. ' +
        `${d || 'ornate, elegant'}. ` +
        'Flat vector illustration, symmetrical, horizontal, centred, ' +
        'isolated on a plain pure white background, filling the frame. ' +
        'No scene, no wall, no hand, no table, no shadow, no extra decoration ' +
        'around it. Clean vector edges.',
      transparent: true, trim: true, aspect: '16:9', needsText: true
    },
    border: {
      label: 'Frame',
      build: (t, d) => `A rectangular ornamental picture frame border. ` +
        `${d || 'ornate gold'}. ` +
        'The centre is completely empty and plain white. ' +
        'Flat vector illustration, perfectly symmetrical, viewed straight on, ' +
        'isolated on a plain pure white background, the frame touching all four edges. ' +
        'No scene, no wall, no picture inside, no shadow, no perspective.',
      transparent: true, trim: false, aspect: '1:1'
    },
    note: {
      label: 'Sticky Note',
      build: (t, d) => `A single blank sticky note. ${d || 'yellow paper'}. ` +
        'Photographed perfectly flat from directly above, filling the whole frame, ' +
        'isolated on a plain pure white background. ' +
        'No desk, no wall, no pen, no hand, no shadow, no other notes, no text.',
      transparent: true, trim: true, aspect: '1:1'
    },
    paper: {
      label: 'Paper',
      build: (t, d) => `A flatbed scan of ${d || 'lined writing paper'}. ` +
        'The paper surface completely fills the image from edge to edge, ' +
        'photographed straight down at 90 degrees, evenly lit, blank and unwritten, ' +
        'flat graphic texture. ' +
        'No desk, no room, no pencils, no objects, no shadow, no perspective.',
      transparent: false, trim: false, aspect: '3:4'
    },
    texture: {
      label: 'Texture',
      build: (t, d) => `A seamless flat ${d || 'textured surface'}, evenly lit. ` +
        'Fills the entire frame edge to edge as a repeating pattern. ' +
        'No subject, no object, no text, no border, no vignette, no shadow.',
      transparent: false, trim: false, aspect: '1:1'
    },
    canvas: {
      label: 'Background',
      build: (t, d) => `An abstract atmospheric background. ${d || 'deep midnight gradient'}. ` +
        'Soft depth, subtle detail, fills the entire frame. ' +
        'No subject, no object, no text, no figures, no horizon line, no border.',
      transparent: false, trim: false, aspect: '3:4'
    }
  };

  // Scored against the description. The winner becomes the category,
  // so generating "white lambo outside a glass mansion" files under
  // cars rather than uncategorised.
  const CATEGORY_WORDS = {
    mansions: ['mansion','villa','estate','house','home','architecture','property','residence','penthouse'],
    cars:     ['car','lamborghini','ferrari','porsche','mclaren','bugatti','bentley','rolls','supercar','coupe','vehicle','lambo','maserati','aston'],
    yachts:   ['yacht','superyacht','boat','sailing','marina','deck','vessel','catamaran'],
    jets:     ['jet','plane','aircraft','aviation','flight','gulfstream','cockpit','runway','tarmac'],
    beaches:  ['beach','ocean','sea','island','tropical','shore','coast','lagoon','sand','maldives','waves'],
    travel:   ['travel','destination','resort','hotel','mountain','city','landscape','trip','vacation','safari'],
    fitness:  ['fitness','gym','workout','muscle','athlete','training','physique','run','strength','abs','lifting'],
    family:   ['family','children','kids','wife','husband','parents','baby','wedding','marriage','couple'],
    career:   ['career','office','business','desk','ceo','executive','work','professional','meeting','corporate','startup'],
    wealth:   ['wealth','money','rich','luxury','gold','million','cash','affluent','champagne','designer','diamond'],
    wellness: ['wellness','spa','meditation','calm','peace','yoga','zen','serene','mindful','healing'],
    'designer-logos': ['gucci','fendi','ysl','prada','chanel','versace','dior','louis','vuitton','hermes','balenciaga','boutique','couture']
  };

  function categorise(description) {
    const text = (description || '').toLowerCase();
    let best = 'uncategorised', bestScore = 0;

    for (const [cat, words] of Object.entries(CATEGORY_WORDS)) {
      let n = 0;
      words.forEach(w => {
        // Word-boundary match so "car" does not fire on "carpet".
        if (new RegExp(`\\b${w}`, 'i').test(text)) n++;
      });
      if (n > bestScore) { bestScore = n; best = cat; }
    }
    return { category: best, confidence: bestScore };
  }

  let _sb = null, _userId = null;
  function init({ sb, userId }) { _sb = sb; _userId = userId; }

  const fnUrl = () => {
    const base = (window.FOCYL_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
    return `${base}/functions/v1/ai-image`;
  };

  /* ============================================================
     generate — one call, returns a Blob.
     ============================================================ */
  async function generate(prompt, { intent = 'photo', refImage = null, text = '' } = {}) {
    // Lettering and ribbons must go to Gemini: FLUX cannot render
    // words, and silently returns a different word instead.
    const spec = INTENTS[intent] || INTENTS.photo;
    // Asset intents build a full instruction; photo just appends style.
    const full = spec.build
      ? spec.build(String(text || '').trim(), prompt)
      : `${prompt}. ${spec.suffix}`;

    const res = await fetch(fnUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${window.FOCYL_CONFIG.supabaseAnonKey}`
      },
      body: JSON.stringify({
        prompt: full, raw: true, refImage,
        geminiOnly: !!spec.needsText && !!String(text || '').trim()
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (data.error === 'text_needs_gemini') {
        throw new Error(data.hint || 'Text rendering needs Gemini, which is unavailable right now.');
      }
      if (res.status === 429) throw new Error('Daily generation limit reached.');
      if (data.error === 'no_keys_configured') {
        throw new Error('No API key set. Add GEMINI_API_KEY in Supabase → Edge Functions → Secrets.');
      }
      throw new Error(data.attempts?.join(' | ') || data.error || 'Generation failed');
    }

    const raw = data.b64 || data.image || data.data;
    if (!raw) {
      throw new Error(
        'Provider returned no image. ' + (data.attempts?.join(' | ') || data.error || '')
      );
    }

    let blob = b64ToBlob(raw, data.mime || 'image/png');
    if (spec.transparent) blob = await knockoutWhite(blob);
    // Crop away the empty margin. Without this a ribbon arrives as a
    // small shape floating in a 1024-square, which places on the board
    // as a mostly-invisible tile.
    if (spec.trim) blob = await trimToContent(blob);

    return {
      blob,
      provider: data.provider,
      failoverReason: data.failoverReason || null,
      fullPrompt: full,
      transparent: spec.transparent
    };
  }

  /* ============================================================
     knockoutWhite — makes lettering and ribbons usable.

     Image models return an opaque rectangle. A gold ribbon on a
     white block looks broken on a dark board, so the flat
     background the prompt asked for is turned transparent here.
     ============================================================ */
  function knockoutWhite(blob, tolerance = 52) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const px = ctx.getImageData(0, 0, c.width, c.height);
        const d = px.data;

        // Sample the corners rather than assuming white — if the model
        // returned a light grey card, that is the colour to remove.
        const corners = [
          0,
          (c.width - 1) * 4,
          (c.height - 1) * c.width * 4,
          ((c.height - 1) * c.width + c.width - 1) * 4
        ];
        let br = 0, bg = 0, bb = 0;
        corners.forEach(i => { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; });
        br /= 4; bg /= 4; bb /= 4;

        for (let i = 0; i < d.length; i += 4) {
          const dist = Math.sqrt(
            (d[i] - br) ** 2 + (d[i + 1] - bg) ** 2 + (d[i + 2] - bb) ** 2
          );
          if (dist < tolerance) {
            d[i + 3] = 0;                                  // fully transparent
          } else if (dist < tolerance * 2.2) {
            // Feather the rim so edges are not jagged.
            d[i + 3] = Math.round(255 * ((dist - tolerance) / (tolerance * 1.2)));
          }
        }

        ctx.putImageData(px, 0, 0);
        c.toBlob(b => resolve(b || blob), 'image/png');
      };
      img.onerror = () => resolve(blob);
      img.src = URL.createObjectURL(blob);
    });
  }

  /* ============================================================
     trimToContent — crop to the visible pixels.

     After the knockout the subject usually occupies the middle 60%
     of a square. Cropping to the alpha bounding box is what turns a
     generated picture into a board-ready asset with the right shape.
     ============================================================ */
  function trimToContent(blob, pad = 6) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        let top = c.height, left = c.width, right = 0, bottom = 0, found = false;

        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (data[(y * c.width + x) * 4 + 3] > 12) {
              found = true;
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
            }
          }
        }
        if (!found) return resolve(blob);

        left = Math.max(0, left - pad);
        top = Math.max(0, top - pad);
        right = Math.min(c.width - 1, right + pad);
        bottom = Math.min(c.height - 1, bottom + pad);

        const w = right - left + 1, h = bottom - top + 1;
        if (w < 8 || h < 8) return resolve(blob);

        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        out.getContext('2d').drawImage(c, left, top, w, h, 0, 0, w, h);
        out.toBlob(b => resolve(b || blob), 'image/png');
      };
      img.onerror = () => resolve(blob);
      img.src = URL.createObjectURL(blob);
    });
  }

  /* ============================================================
     save — Storage + index row. This is what builds the library.
     ============================================================ */
  async function save(result, { prompt, category = 'uncategorised', kind = 'image' }) {
    const media = await FocylMedia.uploadImage(result.blob, 'generated', {
      source: 'ai',
      license: 'Generated',
      keepOriginal: false
    });

    let row = null;
    if (_sb && _userId && !FocylMedia.isLocal()) {
      const { data } = await _sb.from('generated_assets').insert({
        user_id: _userId,
        category,
        kind,
        prompt,
        full_prompt: result.fullPrompt,
        provider: result.provider,
        path: media.path,
        url: media.url,
        w: media.w,
        h: media.h,
        transparent: result.transparent
      }).select().maybeSingle();
      row = data;
    }

    return { ...media, id: row?.id || crypto.randomUUID(), transparent: result.transparent };
  }

  /* Everything previously generated, newest first. Powers the
     library grid so past work is reusable rather than one-shot. */
  async function history({ category = null, limit = 40 } = {}) {
    if (!_sb || !_userId || FocylMedia.isLocal()) return [];
    let q = _sb.from('generated_assets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (category) q = q.eq('category', category);
    const { data } = await q;
    return data || [];
  }

  async function countToday() {
    if (!_sb || !_userId || FocylMedia.isLocal()) return 0;
    const { data } = await _sb.rpc('generations_today', { uid: _userId });
    return data || 0;
  }

  function b64ToBlob(input, mime) {
    let b64 = String(input || '');

    // Some providers hand back a full data URL rather than raw base64.
    const comma = b64.indexOf(',');
    if (b64.startsWith('data:') && comma > -1) {
      const m = /data:(.*?);/.exec(b64.slice(0, comma));
      if (m) mime = m[1];
      b64 = b64.slice(comma + 1);
    }

    // Strip whitespace and newlines, normalise URL-safe alphabet,
    // restore padding. Any of these will break a bare atob() call.
    b64 = b64.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);

    let bin;
    try { bin = atob(b64); }
    catch (e) {
      throw new Error('Image data was not valid base64 (' + b64.length + ' chars)');
    }

    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/png' });
  }

  function blobToDataUrl(blob) {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
  }

  window.FocylAI = {
    init, generate, save, history, countToday, categorise, CATEGORY_WORDS, trimToContent,
    knockoutWhite, blobToDataUrl, INTENTS
  };
})();
