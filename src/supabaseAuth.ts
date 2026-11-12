import type { SupabaseClient } from "@supabase/supabase-js";
import { api, type Me } from "./api.ts";
import { t } from "./i18n.ts";

// Signing in with Supabase Auth, when the server says it's in use (GET /api/auth/me → supabase). Passwords go to
// Supabase only; then the server is handed the access token, checks it with Supabase, and signs this device in.
// Supabase's library is only loaded when it's needed.

export type SupabaseConfig = { url: string; publishableKey: string };

let config: SupabaseConfig | null = null;
let client: Promise<SupabaseClient> | undefined;

export const setSupabaseConfig = (c: SupabaseConfig | null) => {
  config = c;
};
export const supabaseOn = () => !!config;

function supabase(): Promise<SupabaseClient> {
  if (!config) throw new Error("Supabase isn't set up");
  const { url, publishableKey } = config;
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    // Links in Supabase's emails come back with the session after "#", where this app keeps its pages: it's read
    // (and cleared) by finishEmailLink below, not automatically.
    createClient(url, publishableKey, { auth: { flowType: "implicit", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true } }),
  );
  return client;
}

const PENDING_INVITE = "estela-pending-invite";
const remember = (invite?: string) => {
  try {
    if (invite) localStorage.setItem(PENDING_INVITE, invite);
  } catch {
    /* fine without */
  }
};
/** An invite opened before signing up: joined once the email is confirmed (perhaps in another tab). */
export function takePendingInvite() {
  try {
    const v = localStorage.getItem(PENDING_INVITE) ?? undefined;
    localStorage.removeItem(PENDING_INVITE);
    return v;
  } catch {
    return undefined;
  }
}

const message = (e: { message?: string; code?: string } | null) => {
  if (!e) return t("Something went wrong. Please try again.");
  if (e.code === "invalid_credentials") return t("Email or password is incorrect");
  if (e.code === "email_not_confirmed") return t("Confirm your email first: open the link we sent you.");
  if (e.code === "user_already_exists") return t("There's already an account with that email. Sign in instead.");
  if (e.code === "weak_password") return t("That password is too easy to guess. Try a longer one.");
  if (e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit") return t("Too many emails just now. Wait a little and try again.");
  return e.message ?? t("Something went wrong. Please try again.");
};

/** Hands Supabase's session to the server, which signs this device in. */
async function toServer(accessToken: string, name?: string): Promise<Me> {
  return (await api.supabaseSession(accessToken, name)).user;
}

export async function signInWithPassword(email: string, password: string): Promise<Me> {
  const sb = await supabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(message(error));
  return toServer(data.session.access_token);
}

/** A new account. Usually Supabase first emails a link to confirm the address: then there's no user yet. */
export async function signUp(name: string, email: string, password: string, invite?: string): Promise<Me | "confirm"> {
  const sb = await supabase();
  remember(invite);
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${location.origin}/` } });
  if (error) throw new Error(message(error));
  // Supabase answers an existing, confirmed email the same as a new one (so it can't be used to find accounts).
  if (!data.session) return "confirm";
  return toServer(data.session.access_token, name);
}

export async function sendReset(email: string) {
  const sb = await supabase();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
  if (error) throw new Error(message(error));
}

/** Choosing a new password, from a reset email's link: saved, this device signed in, the others signed out. */
export async function setNewPassword(password: string): Promise<Me> {
  const sb = await supabase();
  const { data, error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(message(error));
  const session = (await sb.auth.getSession()).data.session;
  if (!session || !data.user) throw new Error(t("This reset link has expired. Ask for a new one."));
  const me = await toServer(session.access_token);
  await sb.auth.signOut({ scope: "others" }).catch(() => undefined);
  await api.passwordChanged().catch(() => undefined);
  return me;
}

/** Changing your password from Account: the current one is checked first. */
export async function changePassword(email: string, current: string, password: string) {
  const sb = await supabase();
  const check = await sb.auth.signInWithPassword({ email, password: current });
  if (check.error) throw new Error(check.error.code === "invalid_credentials" ? t("Your current password is incorrect") : message(check.error));
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(message(error));
  await sb.auth.signOut({ scope: "others" }).catch(() => undefined);
  await api.passwordChanged();
}

/** A new email: Supabase sends a link to the new address; it's changed once that's opened. */
export async function changeEmail(email: string, current: string, password: string) {
  const sb = await supabase();
  const check = await sb.auth.signInWithPassword({ email: current, password });
  if (check.error) throw new Error(check.error.code === "invalid_credentials" ? t("Your password is incorrect") : message(check.error));
  const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: `${location.origin}/` });
  if (error) throw new Error(message(error));
}

export async function signOutOfSupabase() {
  if (!config) return;
  await (await supabase()).auth.signOut({ scope: "local" }).catch(() => undefined);
}

/**
 * Opening a link from one of Supabase's emails: the app opens with "#access_token=…&type=…" (or "#error=…").
 * Confirming a new account or email signs this device in; a password reset asks for the new password first.
 */
export function emailLinkInAddress(): { kind: "signin" | "reset" | "error"; error?: string } | undefined {
  const h = location.hash.replace(/^#/, "");
  if (!/(^|&)(access_token|error_description|error)=/.test(h)) return undefined;
  const p = new URLSearchParams(h);
  if (p.get("error") || p.get("error_description")) {
    const why = p.get("error_code") === "otp_expired" ? t("This link has expired or was already used. Ask for a new one.") : (p.get("error_description") ?? t("This link didn't work."));
    return { kind: "error", error: why };
  }
  return { kind: p.get("type") === "recovery" ? "reset" : "signin" };
}

/** Takes the session from the address (and clears it from there). Signs in, unless it's a reset. */
export async function finishEmailLink(kind: "signin" | "reset"): Promise<Me | "reset"> {
  const sb = await supabase();
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  const access_token = p.get("access_token");
  const refresh_token = p.get("refresh_token");
  if (!access_token || !refresh_token) throw new Error(t("This link didn't work. Ask for a new one."));
  const { error } = await sb.auth.setSession({ access_token, refresh_token });
  if (error) throw new Error(message(error));
  if (kind === "reset") return "reset";
  return toServer(access_token);
}
