/* ============================================================
   FOCYL — SHARED CONFIG
   Loaded BEFORE any page script. One place for every key.

   The anon key is safe in the browser ONLY if Row Level Security
   is enabled on every table. It is not enabled yet — see
   db/schema.sql. Turn it on before this goes public.

   Anything with a secret (Unsplash, Pexels, image generation,
   Stripe) does NOT belong in this file. Those go in a Supabase
   Edge Function. See db/schema.sql for the pattern.
   ============================================================ */
window.FOCYL_CONFIG = {
  supabaseUrl:     'https://ufkgmldvclvkzvznsxbs.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVma2dtbGR2Y2x2a3p2em5zeGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NjI1MjksImV4cCI6MjEwMzQzODUyOX0.k37JPrSqcDC1zTfh3GYYo71PpWbSAD_Jr0FmhFMqD5o',

  // Server-side proxies. Empty = feature disabled, no crash.
  fn: {
    photoSearch:  '/functions/v1/photo-search',   // wraps Unsplash/Pexels key
    imageGenerate:'/functions/v1/image-generate', // wraps the image model key
    sparksSpend:  '/functions/v1/sparks-spend'    // authoritative credit ledger
  },

  storage: {
    bucket: 'board-media',      // Supabase Storage bucket for tile images/audio
    maxImagePx: 2048,           // long edge; 800 is too small for a 300dpi print
    maxAudioMB: 8
  },

  // Sparks = 1 cent of loaded AI cost. Client displays; server decides.
  sparks: { startingBalance: 100 },

  // Local-only session so you can work while email confirmation is being
  // set up. Set to false before launch — it is a front door with no lock.
  devBypass: true
};
