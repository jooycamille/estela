import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { supabaseConfigured } from "./supabaseStore.ts";

// Attachments (tickets, vouchers) and your photos of places in Supabase Storage, in a private bucket only Estela's
// server can reach (with the secret key). This computer's copy is kept as a cache: files are saved there at once and
// sent to Supabase straight after; one that isn't there (a new computer, a host's fresh disk) is fetched back.
// Without Supabase set up, files simply stay on this computer, as before.

export const BUCKET = "attachments";

const base = () => `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1`;
const headers = () => ({ apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY!}` });
const objectUrl = (key: string) => `${base()}/object/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;

type Job = { kind: "put"; key: string; data: Uint8Array; contentType: string } | { kind: "remove"; keys: string[] };
const queue: Job[] = [];
let running: Promise<void> | undefined;
let failures = 0;

async function run(job: Job) {
  if (job.kind === "put") {
    const res = await fetch(objectUrl(job.key), {
      method: "POST",
      headers: { ...headers(), "Content-Type": job.contentType, "x-upsert": "true" },
      body: new Uint8Array(job.data),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`upload of ${job.key}: ${res.status} ${await res.text().catch(() => "")}`.trim());
  } else {
    const res = await fetch(`${base()}/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: job.keys }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`removing ${job.keys.length} file(s): ${res.status}`);
  }
}

/** Works through the queue in order; a failed job stays first and is tried again a little later. */
function drain() {
  if (running || !queue.length) return running;
  running = (async () => {
    while (queue.length) {
      try {
        await run(queue[0]);
        queue.shift();
        failures = 0;
      } catch (err) {
        failures++;
        console.error(`[storage] ${(err as Error).message}; trying again`);
        await new Promise((r) => setTimeout(r, Math.min(60_000, 1000 * 2 ** failures)));
      }
    }
  })().finally(() => {
    running = undefined;
  });
  return running;
}

/** A new file: kept here, and sent to Supabase. */
export function putFile(key: string, localPath: string, data: Uint8Array, contentType: string) {
  mkdirSync(dirname(localPath), { recursive: true });
  writeFileSync(localPath, data);
  if (!supabaseConfigured()) return;
  queue.push({ kind: "put", key, data, contentType });
  void drain();
}

/** Files no longer used: removed from Supabase too. */
export function removeFiles(keys: string[]) {
  if (!keys.length || !supabaseConfigured()) return;
  // Not yet sent? Then there's nothing to remove there; just don't send it.
  for (let i = queue.length - 1; i >= 0; i--) {
    const j = queue[i];
    if (j.kind === "put" && keys.includes(j.key) && i > 0) queue.splice(i, 1);
  }
  queue.push({ kind: "remove", keys });
  void drain();
}

/**
 * Makes sure the file is on this computer, fetching it from Supabase if need be. False: it isn't anywhere.
 * (A file still waiting to be sent is already here.)
 */
export async function ensureLocal(key: string, localPath: string): Promise<boolean> {
  if (existsSync(localPath)) return true;
  if (!supabaseConfigured()) return false;
  const res = await fetch(objectUrl(key), { headers: headers(), signal: AbortSignal.timeout(60_000) }).catch(() => undefined);
  if (!res?.ok) return false;
  mkdirSync(dirname(localPath), { recursive: true });
  writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
  return true;
}

/** Before the server stops: files still waiting are sent. */
export async function flushFiles() {
  await drain();
}

export const filesWaiting = () => queue.length;
