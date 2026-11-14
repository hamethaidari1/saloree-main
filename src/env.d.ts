/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_PROJECT_ID: string;
  /** Main marketplace domain, e.g. "saloree.com"; stores live at <slug>.<domain>. */
  readonly VITE_ROOT_DOMAIN?: string;
  /** "true" shows "Pay by card" (Stripe Checkout) at checkout; anything else hides it. */
  readonly VITE_STRIPE_ENABLED?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
