/* ============================================================
   FOCYL — MEDIA
   Uploads to Supabase Storage and returns a URL.

   Replaces base64-in-jsonb. A 2048px JPEG is ~600KB as a file and
   ~800KB as base64 text inside a database row — and the row version
   is fetched in full on every board load, for every tile, forever.
   At a thousand users that is the difference between a working
   product and a stalled one.

   Two sizes are kept per image:
     display  — 2048px long edge, what the board renders
     original — untouched, what Press sends to the printer

   Path: <userId>/<boardId>/<uuid>-<variant>.<ext>
   RLS policy keys on the first path segment being the user id.
   ============================================================ */
(() => {
  const DISPLAY_MAX = 2048;   // long edge for on-screen tiles
  const PRINT_MIN   = 2400;   // below this, 8x10 at 300dpi is not safe

  let _sb = null, _userId = null, _bucket = 'board-media';

  function init({ sb, userId, bucket }) {
    _sb = sb; _userId = userId;
    if (bucket) _bucket = bucket;
  }

  const isLocal = () => !_sb || !_userId ||
    _userId === '00000000-0000-0000-0000-000000000000';

  /* ---- resize in a canvas, return a Blob ---- */
  function resize(imgOrBitmap, maxEdge, quality = 0.88) {
    const w0 = imgOrBitmap.naturalWidth || imgOrBitmap.width;
    const h0 = imgOrBitmap.naturalHeight || imgOrBitmap.height;
    let w = w0, h = h0;
    if (Math.max(w, h) > maxEdge) {
      if (w >= h) { h = Math.round(h * maxEdge / w); w = maxEdge; }
      else        { w = Math.round(w * maxEdge / h); h = maxEdge; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(imgOrBitmap, 0, 0, w, h);
    return new Promise(res => c.toBlob(b => res({ blob: b, w, h }), 'image/jpeg', quality));
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Image decode failed'));
      i.src = src;
    });
  }

  async function put(blob, boardId, variant, ext = 'jpg') {
    const path = `${_userId}/${boardId || 'loose'}/${crypto.randomUUID()}-${variant}.${ext}`;
    const { error } = await _sb.storage.from(_bucket)
      .upload(path, blob, { cacheControl: '31536000', upsert: false, contentType: blob.type });
    if (error) throw error;
    const { data } = _sb.storage.from(_bucket).getPublicUrl(path);
    return { path, url: data.publicUrl };
  }

  /* ============================================================
     uploadImage — the one entry point for any image entering a board.
     Falls back to a data URL when there is no real session, so local
     mode still works instead of silently dropping the upload.
     ============================================================ */
  async function uploadImage(fileOrBlob, boardId, opts = {}) {
    const objUrl = URL.createObjectURL(fileOrBlob);
    let img;
    try { img = await loadImage(objUrl); }
    finally { /* revoked below, after resize reads the pixels */ }

    const natural = { w: img.naturalWidth, h: img.naturalHeight };
    const display = await resize(img, DISPLAY_MAX);
    URL.revokeObjectURL(objUrl);

    const result = {
      w: display.w, h: display.h,
      naturalW: natural.w, naturalH: natural.h,
      printSafe: Math.min(natural.w, natural.h) >= PRINT_MIN,
      source: opts.source || 'upload',
      credit: opts.credit || null,
      license: opts.license || null
    };

    if (isLocal()) {
      // No account: keep it on the device. Honest about the tradeoff
      // rather than pretending it synced.
      result.url = await blobToDataUrl(display.blob);
      result.storage = 'local';
      return result;
    }

    const disp = await put(display.blob, boardId, 'display');
    result.url = disp.url;
    result.path = disp.path;
    result.storage = 'supabase';

    // Keep the original only when it is worth keeping for print.
    if (opts.keepOriginal !== false && result.printSafe) {
      try {
        const orig = await put(fileOrBlob, boardId, 'original',
          (fileOrBlob.type || '').includes('png') ? 'png' : 'jpg');
        result.originalUrl = orig.url;
        result.originalPath = orig.path;
      } catch (_) { /* display copy already succeeded; not fatal */ }
    }
    return result;
  }

  /* Pull a remote image (search result, AI output) into our own storage
     so the board never depends on someone else's CDN staying up. */
  async function ingestRemote(url, boardId, meta = {}) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const blob = await res.blob();
    return uploadImage(blob, boardId, { ...meta, keepOriginal: true });
  }

  async function remove(paths = []) {
    if (isLocal() || !paths.length) return;
    try { await _sb.storage.from(_bucket).remove(paths.filter(Boolean)); } catch (_) {}
  }

  function blobToDataUrl(blob) {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
  }

  window.FocylMedia = {
    init, uploadImage, ingestRemote, remove, resize, blobToDataUrl,
    DISPLAY_MAX, PRINT_MIN, isLocal
  };
})();
