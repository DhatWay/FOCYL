/* ────────────────────────────────────────────────────────────
   FOCYL — SHARED SUPABASE CLIENT
   Loaded after the supabase-js CDN script on every page that
   needs auth or data. Edit the key here once, not per-page.

   Get both from: Supabase dashboard → Settings → API
──────────────────────────────────────────────────────────── */
const SUPABASE_URL = 'https://ufkgmldvclvkzvznsxbs.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // paste the anon/public key here

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
