// Copies Estela from this computer (data/db.json and data/attachments) into a Supabase project, once.
//
//   ENV_FILE=.env npx tsx scripts/import-to-supabase.ts          # a dry run: says what it would copy
//   ENV_FILE=.env npx tsx scripts/import-to-supabase.ts --go     # copies it
//
// Stop Estela (and any server using the project) first. The project is the one in ENV_FILE (SUPABASE_URL and SUPABASE_SECRET_KEY). Its tables must exist (supabase/migrations)
// and hold no trips yet. Nothing on this computer is changed: data/db.json stays as it is, as a backup.
// SOURCE=path/to/db.json copies another file (its attachments folder next to it).
import "../server/env.ts";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Data } from "../server/db.ts";
import { BUCKET } from "../server/fileStore.ts";
import { MUST_BE_EMPTY, planImport } from "../server/importPlan.ts";
import { COLLECTIONS, loadStore, supabase, supabaseConfigured, type CollectionKey } from "../server/supabaseStore.ts";

const go = process.argv.includes("--go");
const source = resolve(process.env.SOURCE ?? "data/db.json");
const filesDir = join(dirname(source), "attachments");

if (!supabaseConfigured()) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY first (in the file ENV_FILE names).");
const project = new URL(process.env.SUPABASE_URL!).host;
console.log(`From: ${source}\nTo:   Supabase ${project}${go ? "" : "  (dry run: nothing is written)"}\n`);
console.log("Stop Estela first (Ctrl+C where it runs), and any copy using this project: a running server keeps its own\ncopy of the data in memory and would write over what's imported.\n");

const empty = (): Data => ({ trips: [], items: [], inboxes: [], attachments: [], lists: [], users: [], sessions: [], invites: [], pushSubs: [], remindersSent: [] });
const from: Data = { ...empty(), ...(JSON.parse(readFileSync(source, "utf8")) as Partial<Data>) };
const target = (await loadStore(empty() as never)) as unknown as Data;

const busy = MUST_BE_EMPTY.filter((k) => target[k].length);
if (busy.length) {
  console.error(`Stopped: this project already has ${busy.map((k) => `${target[k].length} ${k}`).join(", ")}. Import into a project without trips.`);
  process.exit(1);
}

const plan = planImport(from, target);
const files = plan.data.attachments.map((a) => ({ key: `${a.id}/${basename(a.path)}`, local: join(filesDir, a.id, basename(a.path)), type: a.contentType, size: a.size }));
const missing = files.filter((f) => !existsSync(f.local));

for (const key of Object.keys(COLLECTIONS) as CollectionKey[]) console.log(`  ${COLLECTIONS[key].table.padEnd(15)} ${plan.data[key].length}`);
console.log(`  ${"files".padEnd(15)} ${files.length - missing.length} (${(files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1)} MB)`);
if (missing.length) console.log(`  (${missing.length} file(s) listed but not on this computer: their bookings keep the name, without the file)`);
for (const n of plan.notes) console.log(`  · ${n}`);

if (!go) {
  console.log("\nLooks right? Run it again with --go to copy.");
  process.exit(0);
}

console.log("\nCopying…");
const headers = { apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY!}` };
const base = `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1/object/${BUCKET}`;
let sent = 0;
for (const f of files) {
  if (!existsSync(f.local)) continue;
  const res = await fetch(`${base}/${f.key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": f.type || "application/octet-stream", "x-upsert": "true" },
    body: new Uint8Array(readFileSync(f.local)),
  });
  if (!res.ok) throw new Error(`Couldn't upload ${f.key}: ${res.status} ${await res.text()}`);
  sent++;
}
console.log(`  files: ${sent} uploaded`);

// Records last, so a stopped copy can simply be run again (the trips table is only filled at the very end).
const order: CollectionKey[] = ["users", "sessions", "invites", "pushSubs", "remindersSent", "attachments", "inboxes", "lists", "items", "trips"];
for (const key of order) {
  const { table, id } = COLLECTIONS[key];
  const rows = (plan.data[key] as unknown[]).map((r) => ({ id: (id as (r: unknown) => string)(r), data: r, updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase().from(table).upsert(rows.slice(i, i + 200));
    if (error) throw new Error(`Couldn't copy ${table}: ${error.message}`);
  }
  console.log(`  ${table}: ${rows.length}`);
}
if (plan.dropUsers.length) {
  const { error } = await supabase().from("users").delete().in("id", plan.dropUsers);
  if (error) throw new Error(`Couldn't tidy up accounts: ${error.message}`);
}

// Check: read it all back.
const after = (await loadStore(empty() as never)) as unknown as Data;
const wrong = (Object.keys(COLLECTIONS) as CollectionKey[]).filter((k) => after[k].length !== plan.data[k].length);
if (wrong.length) throw new Error(`Copied, but the counts don't match for: ${wrong.join(", ")}`);
console.log(`\nDone. Everything is in Supabase ${project}. data/db.json is unchanged: keep it as a backup.`);
