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
      transparent: false
    },
    lettering: {
      label: 'Lettering',
      // Flat solid background is deliberate: it is what makes the
      // knockout below clean. Ask for a gradient and the edges smear.
      suffix: 'ornate hand-lettered typography, elegant calligraphy, gold and ' +
              'metallic finish, centred, on a plain flat pure white background, ' +
              'no shadows, no border, high contrast',
      transparent: true
    },
    ribbon: {
      label: 'Ribbon',
      suffix: 'a single decorative ribbon banner, ornate, symmetrical, centred, ' +
              'on a plain flat pure white background, no shadows, no text, ' +
              'vector-like clean edges',
      transparent: true
    },
    border: {
      label: 'Frame',
      suffix: 'an ornate decorative rectangular picture frame, symmetrical, ' +
              'centred, hollow empty centre, on a plain flat pure white ' +
              'background, no shadows',
      transparent: true
    },
    texture: {
      label: 'Texture',
      suffix: 'a seamless flat texture, evenly lit, no subject, no text, ' +
              'fills the entire frame, tileable',
      transparent: false
    },
    canvas: {
      label: 'Background',
      suffix: 'an abstract atmospheric background, soft gradient, subtle depth, ' +
              'no subject, no text, suitable as a backdrop behind other content',
      transparent: false
    }
  };

  let _sb = null, _userId = null;
  function init({ sb, userId }) { _sb = sb; _userId = userId; }

  const fnUrl = () => {
    const base = (window.FOCYL_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
    return `${base}/functions/v1/ai-image`;
  };

  /* ============================================================
     generate — one call, returns a Blob.
     ============================================================ */
  async function generate(prompt, { intent = 'photo', refImage = null } = {}) {
    const spec = INTENTS[intent] || INTENTS.photo;
    const full = `${prompt}. ${spec.suffix}`;

    const res = await fetch(fnUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${window.FOCYL_CONFIG.supabaseAnonKey}`
      },
      body: JSON.stringify({ prompt: full, raw: true, refImage })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 429) throw new Error('Daily generation limit reached.');
      if (data.error === 'no_keys_configured') {
        throw new Error('No API key set. Add GEMINI_API_KEY in Supabase → Edge Functions → Secrets.');
      }
      throw new Error(data.attempts?.join(' | ') || data.error || 'Generation failed');
    }

    let blob = b64ToBlob(data.image, data.mime || 'image/png');
    if (spec.transparent) blob = await knockoutWhite(blob);

    return {
      blob,
      provider: data.provider,
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
  function knockoutWhite(blob, tolerance = 26) {
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

  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
  }

  window.FocylAI = {
    init, generate, save, history, countToday,
    knockoutWhite, blobToDataUrl, INTENTS
  };
})();
