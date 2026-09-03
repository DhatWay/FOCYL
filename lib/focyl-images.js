// ============================================================
// FOCYL — ai-image Edge Function
//
// One endpoint, several providers, automatic failover.
// Keys live here as secrets and never reach the browser.
//
// Deploy:
//   supabase functions deploy ai-image
//
// Secrets (set at least one):
//   supabase secrets set GEMINI_API_KEY=...        ← primary, free tier
//   supabase secrets set CF_ACCOUNT_ID=...         ← fallback
//   supabase secrets set CF_API_TOKEN=...
//
// Order is deliberate: Gemini first because its free tier is the most
// generous and it can edit an existing image, not just generate one.
// Cloudflare FLUX picks up when Gemini's daily quota is exhausted.
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const GEMINI_MODEL = 'gemini-2.5-flash-image';
const CF_MODEL = '@cf/black-forest-labs/flux-1-schnell';

// A bare noun makes a bare image. These are appended so a one-word
// prompt still produces something that belongs on a vision board.
const STYLE = 'photorealistic, editorial photography, dramatic natural light, ' +
              'shallow depth of field, high detail, aspirational, cinematic colour grading';

const NEGATIVE = 'text, watermark, logo, signature, blurry, low quality, ' +
                 'distorted, deformed, cartoon, illustration, cgi, render';

// ---------- GEMINI ----------
async function viaGemini(key: string, prompt: string, refImage: string | null) {
  const parts: unknown[] = [{ text: prompt }];

  // A reference image turns generation into editing — this is what
  // makes Redesign preserve the subject instead of inventing a new one.
  if (refImage) {
    const [meta, b64] = refImage.split(',');
    const mime = /data:(.*?);/.exec(meta)?.[1] || 'image/jpeg';
    parts.unshift({ inline_data: { mime_type: mime, data: b64 } });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    }
  );

  if (res.status === 429) throw new Error('QUOTA');
  if (!res.ok) throw new Error('gemini_' + res.status);

  const data = await res.json();
  const blocks = data?.candidates?.[0]?.content?.parts || [];
  const img = blocks.find((p: Record<string, unknown>) => p.inline_data || p.inlineData);
  const inline = (img?.inline_data || img?.inlineData) as { data: string; mime_type?: string } | undefined;
  if (!inline?.data) throw new Error('gemini_no_image');

  return { b64: inline.data, mime: inline.mime_type || 'image/png', provider: 'gemini' };
}

// ---------- CLOUDFLARE ----------
async function viaCloudflare(acct: string, token: string, prompt: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${CF_MODEL}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, steps: 4 })
    }
  );

  if (res.status === 429) throw new Error('QUOTA');
  if (!res.ok) throw new Error('cf_' + res.status);

  const data = await res.json();
  const b64 = data?.result?.image;
  if (!b64) throw new Error('cf_no_image');
  return { b64, mime: 'image/jpeg', provider: 'cloudflare' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return Response.json({ error: 'bad_json' }, { status: 400, headers: CORS }); }

  const raw = String(body.prompt || '').trim().slice(0, 600);
  if (!raw) return Response.json({ error: 'no_prompt' }, { status: 400, headers: CORS });

  const refImage = typeof body.refImage === 'string' ? body.refImage : null;
  const styled = body.raw === true ? raw : `${raw}. ${STYLE}. Avoid: ${NEGATIVE}.`;

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  const cfAcct = Deno.env.get('CF_ACCOUNT_ID');
  const cfToken = Deno.env.get('CF_API_TOKEN');

  const attempts: string[] = [];

  // Gemini first. Also the only one that can edit a reference image,
  // so a Redesign request never falls through to Cloudflare.
  if (geminiKey) {
    try {
      const out = await viaGemini(geminiKey, styled, refImage);
      return Response.json({ ...out, prompt: styled }, { headers: CORS });
    } catch (e) {
      attempts.push('gemini:' + (e as Error).message);
      if (refImage) {
        return Response.json(
          { error: 'edit_failed', attempts },
          { status: 502, headers: CORS }
        );
      }
    }
  }

  if (cfAcct && cfToken) {
    try {
      const out = await viaCloudflare(cfAcct, cfToken, styled);
      return Response.json({ ...out, prompt: styled }, { headers: CORS });
    } catch (e) {
      attempts.push('cloudflare:' + (e as Error).message);
    }
  }

  return Response.json(
    {
      error: attempts.length ? 'all_providers_failed' : 'no_keys_configured',
      attempts,
      hint: 'Set GEMINI_API_KEY, or CF_ACCOUNT_ID + CF_API_TOKEN, in Edge Function secrets.'
    },
    { status: 502, headers: CORS }
  );
});
