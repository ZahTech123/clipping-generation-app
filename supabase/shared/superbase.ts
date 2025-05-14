// Using Deno-standard import
import { createClient } from 'https://deno.land/x/supabase@1.3.1/mod.ts'

export const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    db: {
      schema: 'storage'
    }
  }
)