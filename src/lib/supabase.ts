import { createClient } from '@supabase/supabase-js'

// Env vars win when set; the fallbacks keep git-based Vercel builds working without
// project env configuration. The anon key is public by design (it ships in every bundle).
const url = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://zanpnhfcuqznmmokbchv.supabase.co'
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbnBuaGZjdXF6bm1tb2tiY2h2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDkyNjAsImV4cCI6MjA5MDgyNTI2MH0.9kJwToOenAWohju1oBTPlPsFWl42iStONWbMg5aoTGQ'

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})
