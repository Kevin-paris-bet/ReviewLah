// The project URL and the publishable key are public by design (they ship to the browser).
// Access is protected by the Row Level Security rules in supabase/schema.sql.
// Never put the secret / service_role key in this repository.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bbisrzhfwpejcibvpkvf.supabase.co';
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_mCOOFZp0WLuIV8nVW4_s3g_uH0qbjq_';
