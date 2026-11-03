import { useEffect, useRef, useState } from "react";
import { api, type Me } from "../api.ts";
import Logo from "./Logo.tsx";

type Mode = "signin" | "signup" | "forgot";
export type AuthLinks = { invite?: string; reset?: string; link?: string };

/**
 * Signing in and creating an account. Also: choosing a new password from a reset email, signing in with a one-time
 * device or owner link, and joining a trip from an invite (create an account or sign in, then the trip is yours too).
 */
export default function SignIn({
  links,
  claimHere,
  emailReset,
  onSignedIn,
}: {
  links: AuthLinks;
  claimHere: boolean;
  emailReset: boolean;
  onSignedIn: (user: Me, tripId?: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(links.invite || claimHere ? "signup" : "signin");
  const [invite, setInvite] = useState<{ tripName: string; invitedBy: string; invitedName?: string }>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const used = useRef(false);

  // One-time device/owner link: sign in straight away (once; React may run effects twice in development).
  useEffect(() => {
    if (!links.link || used.current) return;
    used.current = true;
    api.redeem(links.link).then(({ user }) => onSignedIn(user)).catch((e) => setError((e as Error).message));
  }, [links.link, onSignedIn]);

  useEffect(() => {
    if (!links.invite) return;
    api
      .invite(links.invite)
      .then((p) => {
        setInvite(p);
        if (p.invitedName) setName((n) => n || p.invitedName!);
      })
      .catch((e) => setError((e as Error).message));
  }, [links.invite]);

  // After signing up or in with an invite, join its trip.
  const done = async (user: Me) => {
    if (links.invite) {
      const { tripId } = await api.acceptInvite(links.invite);
      return onSignedIn(user, tripId);
    }
    onSignedIn(user);
  };
  const submit = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (links.link && !error) {
    return (
      <div className="signin">
        <Logo height={48} />
        <p>Signing you in…</p>
      </div>
    );
  }

  if (links.reset) {
    return (
      <div className="signin">
        <Logo height={48} />
        <h1>Choose a new password</h1>
        {error && <p className="error">{error}</p>}
        <form className="auth-form" onSubmit={submit(async () => onSignedIn((await api.reset(links.reset!, password)).user))}>
          <label>
            New password
            <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <p className="muted tiny">At least 8 characters. A short sentence is easy to remember and hard to guess.</p>
          <button type="submit" disabled={busy || password.length < 8}>{busy ? "Saving…" : "Save and sign in"}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="signin">
      <Logo height={48} />
      {invite ? (
        <div className="invite-banner">
          <b>{invite.invitedBy}</b> invited you to join <b>{invite.tripName}</b>.
          <div className="small">Create a free account (or sign in) to see it. You'll only see the trips you're part of.</div>
        </div>
      ) : (
        <h1>{mode === "signup" ? "Create your Hey Joy account" : mode === "forgot" ? "Forgot your password?" : "Welcome back"}</h1>
      )}
      {claimHere && mode === "signup" && !invite && (
        <p className="claim-note">You're setting up Hey Joy on the Mac it runs on, so your account will own the trips already here.</p>
      )}

      {mode !== "forgot" && (
        <div className="kind-switch auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => setMode("signin")}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")}>
            Create account
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {mode === "signin" && (
        <form className="auth-form" onSubmit={submit(async () => done((await api.signIn({ email, password })).user))}>
          <label>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <button type="button" className="link" onClick={() => { setMode("forgot"); setError(undefined); }}>
            Forgot password?
          </button>
        </form>
      )}

      {mode === "signup" && (
        <form className="auth-form" onSubmit={submit(async () => done((await api.signUp({ name, email, password })).user))}>
          <label>
            Your name
            <input autoComplete="name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="How travel companions will see you" />
          </label>
          <label>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <p className="muted tiny">At least 8 characters. A short sentence is easy to remember and hard to guess.</p>
          <button type="submit" disabled={busy}>{busy ? "Creating your account…" : invite ? "Create account and join" : "Create account"}</button>
        </form>
      )}

      {mode === "forgot" && (
        <form
          className="auth-form"
          onSubmit={submit(async () => {
            await api.forgot(email);
            setNotice(
              emailReset
                ? "If there's an account with that email, we've sent a link to reset your password. It works for 1 hour."
                : "If there's an account with that email, a reset link was made. Email isn't set up yet, so it's shown in the Terminal where Hey Joy is running.",
            );
          })}
        >
          <p className="muted small">Enter your account's email and we'll send you a link to choose a new password.</p>
          <label>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          <button type="button" className="link" onClick={() => { setMode("signin"); setNotice(undefined); }}>
            Back to sign in
          </button>
        </form>
      )}

      <p className="muted tiny signin-foot">
        Signed in on another device? Open <i>👤 your name → Sign in another device</i> there and scan the code. That's handy for the Home Screen app.
      </p>
    </div>
  );
}

/** Opening an invite while already signed in: join the trip and go to it. */
export function JoinTrip({ token, onJoined }: { token: string; onJoined: (tripId: string) => void }) {
  const [error, setError] = useState<string>();
  const used = useRef(false);
  useEffect(() => {
    if (used.current) return;
    used.current = true;
    api.acceptInvite(token).then(({ tripId }) => onJoined(tripId)).catch((e) => setError((e as Error).message));
  }, [token, onJoined]);
  return <div className="signin">{error ? <p className="error">{error}</p> : <p>Joining the trip…</p>}</div>;
}
