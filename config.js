/* ────────────────────────────────────────────────────────────
   FOCYL — SHARED SUPABASE CLIENT
   Loaded after the supabase-js CDN script on every page that
   needs auth or data. Edit the key here once, not per-page.

   Get both from: Supabase dashboard → Settings → API
──────────────────────────────────────────────────────────── */
const SUPABASE_URL = 'https://ufkgmldvclvkzvznsxbs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVma2dtbGR2Y2x2a3p2em5zeGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NjI1MjksImV4cCI6MjEwMzQzODUyOX0.k37JPrSqcDC1zTfh3GYYo71PpWbSAD_Jr0FmhFMqD5o
'; // paste the anon/public key here

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);