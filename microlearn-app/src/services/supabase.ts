import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Ứng dụng chưa được cấu hình Supabase. Hãy thêm URL và anon key vào biến môi trường.');
  }
  return supabase;
}

// Keep the browser auth surface typed narrowly while the generated database
// schema is still being expanded with the Supabase migration.
export function browserAuth() {
  return requireSupabase().auth as unknown as {
    getSession: () => Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }>;
    onAuthStateChange: (callback: (event: string, session: { user: { id: string } } | null) => void) => { data: { subscription: { unsubscribe: () => void } } };
    signUp: (credentials: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => Promise<{ data: { session: unknown }; error: unknown }>;
    signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ error: unknown }>;
    signOut: () => Promise<{ error: unknown }>;
  };
}
