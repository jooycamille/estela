import { PostgrestClient } from "@supabase/postgrest-js";

// Keeping Estela's data in Supabase (Postgres) instead of data/db.json. The server still works from memory, as before:
// everything is loaded once at start, and after each change, the records that changed (and only those) are written
// to their tables, a moment later, in order. See supabase/migrations for the tables.
//
// Used when SUPABASE_URL and SUPABASE_SECRET_KEY are set (the secret key stays on the server; never in the browser).

/** Each part of the data, its table, and how its records are told apart. */
export const COLLECTIONS = {
  trips: { table: "trips", id: (r: { id: string }) => r.id },
  items: { table: "items", id: (r: { id: string }) => r.id },
  lists: { table: "lists", id: (r: { id: string }) => r.id },
  inboxes: { table: "inboxes", id: (r: { tripId: string }) => r.tripId },
  attachments: { table: "attachments", id: (r: { id: string }) => r.id },
  users: { table: "users", id: (r: { id: string }) => r.id },
  sessions: { table: "sessions", id: (r: { id: string }) => r.id },
  invites: { table: "invites", id: (r: { id: string }) => r.id },
  pushSubs: { table: "push_subs", id: (r: { endpoint: string }) => r.endpoint },
  remindersSent: { table: "reminders_sent", id: (r: string) => r },
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;
type Store = Record<CollectionKey, unknown[]>;
const idOf = (key: CollectionKey, record: unknown) => (COLLECTIONS[key].id as (r: unknown) => string)(record);

export const supabaseConfigured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

// Just the database part of Supabase's client (the full one also starts live updates, which need a newer Node.js).
let client: PostgrestClient | undefined;
export function supabase(): PostgrestClient {
  const key = process.env.SUPABASE_SECRET_KEY!;
  client ??= new PostgrestClient(`${process.env.SUPABASE_URL!.replace(/\/$/, "")}/rest/v1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return client;
}

/** What each record looked like when last read or written, so only changes are sent. */
const saved = new Map<CollectionKey, Map<string, string>>();

const PAGE = 1000;

/** Everything, from every table. Throws if Supabase can't be reached: better not to start than to start empty. */
export async function loadStore(empty: Store): Promise<Store> {
  const out = { ...empty };
  for (const key of Object.keys(COLLECTIONS) as CollectionKey[]) {
    const rows: { id: string; data: unknown }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase().from(COLLECTIONS[key].table).select("id, data").order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(`Couldn't read ${COLLECTIONS[key].table} from Supabase: ${error.message}`);
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    out[key] = rows.map((r) => r.data);
    saved.set(key, new Map(rows.map((r) => [r.id, JSON.stringify(r.data)])));
  }
  return out;
}

/** What changed since the last write: records to add or update, and ids to remove. */
export function changes(key: CollectionKey, records: unknown[]) {
  const before = saved.get(key) ?? new Map<string, string>();
  const now = new Map<string, string>();
  const upserts: { id: string; data: unknown }[] = [];
  for (const r of records) {
    const id = idOf(key, r);
    const json = JSON.stringify(r);
    now.set(id, json);
    if (before.get(id) !== json) upserts.push({ id, data: r });
  }
  const removed = [...before.keys()].filter((id) => !now.has(id));
  return { upserts, removed, now };
}

/** Test hook: what's taken as already written. */
export function markSaved(key: CollectionKey, records: unknown[]) {
  saved.set(key, new Map(records.map((r) => [idOf(key, r), JSON.stringify(r)])));
}

async function write(store: Store) {
  for (const key of Object.keys(COLLECTIONS) as CollectionKey[]) {
    const { upserts, removed } = changes(key, store[key]);
    const table = COLLECTIONS[key].table;
    const done = saved.get(key) ?? new Map<string, string>();
    for (let i = 0; i < upserts.length; i += 200) {
      const batch = upserts.slice(i, i + 200);
      const { error } = await supabase().from(table).upsert(batch.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
      if (error) throw new Error(`Couldn't save to ${table}: ${error.message}`);
      for (const r of batch) done.set(r.id, JSON.stringify(r.data));
    }
    for (let i = 0; i < removed.length; i += 200) {
      const batch = removed.slice(i, i + 200);
      const { error } = await supabase().from(table).delete().in("id", batch);
      if (error) throw new Error(`Couldn't remove from ${table}: ${error.message}`);
      for (const id of batch) done.delete(id);
    }
    saved.set(key, done);
  }
}

let pending: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> = Promise.resolve();
let failures = 0;

/** Writes the changes soon (changes made together are sent together), one write at a time, retrying on failure. */
export function scheduleWrite(store: Store) {
  if (pending) return;
  pending = setTimeout(() => {
    pending = undefined;
    running = running.then(() =>
      write(store).then(
        () => { failures = 0; },
        (err) => {
          failures++;
          console.error(`[supabase] ${(err as Error).message}; trying again`);
          setTimeout(() => scheduleWrite(store), Math.min(60_000, 1000 * 2 ** failures));
        },
      ),
    );
  }, 150);
}

/** Before the server stops: whatever's waiting is written. */
export async function flushNow(store: Store) {
  if (pending) {
    clearTimeout(pending);
    pending = undefined;
  }
  await running;
  await write(store).catch((err) => console.error(`[supabase] ${(err as Error).message}`));
}
