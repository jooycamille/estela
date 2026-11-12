import { supabaseConfigured } from "./supabaseStore.ts";

// Signing in with Supabase Auth. The page signs up, signs in and resets passwords with Supabase directly (with the
// project's publishable key, which is made to be public), then hands this server the access token it got. The server
// asks Supabase who that token belongs to, and only then starts Estela's own session (the cookie the app has always
// used, so tickets and photos still open as plain links, and devices can still be signed out from Account).
//
// On when SUPABASE_URL, SUPABASE_SECRET_KEY and VITE_SUPABASE_PUBLISHABLE_KEY are all set.

export const supabaseAuthOn = () => supabaseConfigured() && !!process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** What the page needs to talk to Supabase Auth (both public), or null when it isn't in use. */
export const supabasePublic = () =>
  supabaseAuthOn() ? { url: process.env.SUPABASE_URL!.replace(/\/$/, ""), publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY! } : null;

export interface SupabaseIdentity {
  id: string;
  email: string;
  confirmed: boolean; // the email address was confirmed (a link in it was opened)
  name?: string;
}

/** Who an access token belongs to, as Supabase says (undefined: not a valid, current token). */
export async function identityOf(accessToken: string): Promise<SupabaseIdentity | undefined> {
  if (!supabaseAuthOn() || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(accessToken)) return undefined;
  const res = await fetch(`${process.env.SUPABASE_URL!.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  if (!res?.ok) return undefined;
  const u = (await res.json()) as { id?: string; email?: string; email_confirmed_at?: string | null; user_metadata?: { name?: unknown } };
  if (!u.id || !u.email) return undefined;
  const name = typeof u.user_metadata?.name === "string" ? u.user_metadata.name.trim().slice(0, 40) : undefined;
  return { id: u.id, email: u.email.trim().toLowerCase(), confirmed: !!u.email_confirmed_at, name: name || undefined };
}

/** Deleting an account: its Supabase login goes too (with the secret key; only the server can). */
export async function deleteIdentity(authId: string): Promise<boolean> {
  if (!supabaseAuthOn()) return true;
  const key = process.env.SUPABASE_SECRET_KEY!;
  const res = await fetch(`${process.env.SUPABASE_URL!.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(authId)}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
  return !!res && (res.ok || res.status === 404); // 404: already gone
}
