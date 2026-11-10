import type { Data, UserRecord } from "./db.ts";

// Copying Estela from data/db.json into Supabase, once: what's copied, and how people who already signed in to the new
// project (before the copy) are joined up with their accounts. Only works out the plan; scripts/import-to-supabase.ts
// writes it.

export interface ImportPlan {
  data: Data; // what goes into Supabase
  dropUsers: string[]; // accounts in Supabase that are replaced by the same person's imported account
  notes: string[];
}

/** Collections that must be empty in Supabase before importing (so nothing is overwritten or mixed up). */
export const MUST_BE_EMPTY = ["trips", "items", "lists", "inboxes", "attachments"] as const;

/**
 * `target`: what's in Supabase already (only people and their sessions may be; see MUST_BE_EMPTY).
 * - Everyone signs in again (with Supabase): old sessions aren't copied, nor old passwords.
 * - Trip invites still unused (and not expired) carry on; one-time sign-in and reset links don't.
 * - Someone who signed in to the new project already, with the same email, is joined to their imported account
 *   (trips and all), staying signed in.
 */
export function planImport(source: Data, target: Pick<Data, "users" | "sessions" | "invites" | "pushSubs" | "remindersSent">, now = new Date().toISOString()): ImportPlan {
  const notes: string[] = [];
  const users: UserRecord[] = source.users.map((u) => {
    const { passwordHash: _old, ...rest } = u;
    return { ...rest };
  });
  const byEmail = new Map(users.filter((u) => u.email && !u.placeholder).map((u) => [u.email!.toLowerCase(), u]));

  const dropUsers: string[] = [];
  const sessions = [];
  const kept: UserRecord[] = [];
  for (const t of target.users) {
    const same = t.email && !t.placeholder ? byEmail.get(t.email.toLowerCase()) : undefined;
    if (same) {
      if (same.authId && t.authId && same.authId !== t.authId) throw new Error(`Two different sign-ins for ${t.email}; sort this out before importing.`);
      same.authId ??= t.authId;
      dropUsers.push(t.id);
      sessions.push(...target.sessions.filter((s) => s.userId === t.id).map((s) => ({ ...s, userId: same.id })));
      notes.push(`${same.name}: already signed in to the new project; joined to their imported account.`);
    } else {
      kept.push(t);
      sessions.push(...target.sessions.filter((s) => s.userId === t.id));
    }
  }
  // One owner of Estela: the one who owns the imported trips.
  if (users.some((u) => u.isAdmin)) {
    for (const t of kept)
      if (t.isAdmin) {
        t.isAdmin = false;
        notes.push(`${t.name} owned the new, empty copy; the imported owner owns Estela now.`);
      }
  }

  // What was in Supabase already stays, moved to the joined-up account where it was someone's.
  const joined = new Map(target.users.flatMap((t) => (dropUsers.includes(t.id) ? [[t.id, byEmail.get(t.email!.toLowerCase())!.id] as const] : [])));
  const moved = <T extends { userId: string }>(r: T): T => ({ ...r, userId: joined.get(r.userId) ?? r.userId });

  const invites = source.invites.filter((i) => i.purpose === "invite" && i.expiresAt > now);
  const dropped = source.invites.length - invites.length;
  if (dropped) notes.push(`${dropped} used-up or one-time link(s) not copied (sign-in, reset, expired).`);
  if (source.sessions.length) notes.push(`${source.sessions.length} old sign-in(s) not copied: everyone signs in again, with Supabase.`);

  return {
    data: {
      trips: source.trips,
      items: source.items,
      lists: source.lists,
      inboxes: source.inboxes,
      attachments: source.attachments,
      users: [...users, ...kept],
      sessions,
      invites: [...invites, ...target.invites.map(moved)],
      pushSubs: [...source.pushSubs, ...target.pushSubs.filter((t) => !source.pushSubs.some((s) => s.endpoint === t.endpoint)).map(moved)],
      remindersSent: [...new Set([...source.remindersSent, ...target.remindersSent])],
    },
    dropUsers,
    notes,
  };
}
