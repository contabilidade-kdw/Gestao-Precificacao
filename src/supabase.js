import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const validSupabaseUrl = (() => {
  try {
    const url = new URL(supabaseUrl);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
})();
const configured = validSupabaseUrl
  && typeof supabaseAnonKey === 'string'
  && supabaseAnonKey.length > 20
  && supabaseAnonKey !== 'sua-chave-publica-do-supabase';

export const supabaseConfigured = configured;
export const demoMode = import.meta.env.MODE === 'demo'
  || import.meta.env.VITE_DEMO_MODE === 'true';
export const supabase = configured && !demoMode
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
    realtime: { params: { eventsPerSecond: 10 } },
  })
  : null;

export const db = supabase;
