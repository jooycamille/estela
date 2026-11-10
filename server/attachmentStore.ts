import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { StoredAttachment } from "../shared/types.ts";
import type { Attachment } from "./attachments.ts";
import { DATA_DIR, db, newId, now, save, type AttachmentRecord } from "./db.ts";
import { ensureLocal, putFile, removeFiles } from "./fileStore.ts";

const DIR = join(DATA_DIR, "attachments");
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const publicView = ({ id, filename, contentType, size }: AttachmentRecord): StoredAttachment => ({ id, filename, contentType, size });

/** Where a file is kept: "<id>/<name>" in Supabase Storage, and under data/attachments on this computer. */
export const storageKey = (a: AttachmentRecord) => `${a.id}/${basename(a.path)}`;
const localPath = (a: AttachmentRecord) => join(DIR, a.id, basename(a.path));

/** Save a file and return its reference. Re-importing the same email reuses the file instead of copying it again. */
export function storeAttachment(file: Attachment, emailId?: string, uploadedBy?: string): StoredAttachment {
  const existing = emailId && db.attachments.find((a) => a.emailId === emailId && a.filename === file.filename && a.size === file.data.byteLength);
  if (existing) return publicView(existing);
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`${file.filename} is larger than 15 MB`);
  const id = newId();
  const safeName = file.filename.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
  const contentType = file.contentType || "application/octet-stream";
  const record: AttachmentRecord = { id, filename: file.filename, contentType, size: file.data.byteLength, path: join(DIR, id, safeName), emailId, uploadedBy, createdAt: now() };
  putFile(storageKey(record), localPath(record), file.data, contentType);
  db.attachments.push(record);
  save();
  return publicView(record);
}

export const getAttachment = (id: string) => db.attachments.find((a) => a.id === id);

/** The file on this computer, ready to send (fetched from Supabase first if it isn't here). Undefined: it's gone. */
export async function attachmentFile(a: AttachmentRecord): Promise<string | undefined> {
  const path = localPath(a);
  return (await ensureLocal(storageKey(a), path)) ? path : undefined;
}

function forget(records: AttachmentRecord[]) {
  for (const a of records) rmSync(join(DIR, a.id), { recursive: true, force: true });
  removeFiles(records.map(storageKey));
}

/** Remove files that were saved empty (an earlier bug), and their references, so the bookings can be re-imported cleanly. */
export function dropEmptyAttachments() {
  const empty = db.attachments.filter((a) => a.size === 0);
  if (!empty.length) return 0;
  const ids = new Set(empty.map((a) => a.id));
  for (const item of db.items) {
    item.attachments = item.attachments?.filter((a) => !ids.has(a.id));
    if (!item.attachments?.length) delete item.attachments;
  }
  forget(empty);
  db.attachments = db.attachments.filter((a) => !ids.has(a.id));
  save();
  return empty.length;
}

/** Delete stored files no item refers to any more. */
export function pruneAttachments() {
  const used = new Set([
    ...db.items.flatMap((i) => i.attachments?.map((a) => a.id) ?? []),
    // Your own photos of places on your lists.
    ...db.lists.flatMap((l) => l.entries.map((e) => e.photo?.url.match(/^\/api\/attachments\/([\w-]+)$/)?.[1]).filter((id): id is string => !!id)),
  ]);
  const unused = db.attachments.filter((a) => !used.has(a.id) && !a.emailId);
  if (!unused.length) return;
  forget(unused);
  db.attachments = db.attachments.filter((a) => !unused.includes(a));
  save();
}

/** Deletes one stored file, if nothing (a booking or a place's photo) uses it any more. */
export function removeIfUnused(id: string) {
  const url = `/api/attachments/${id}`;
  const used = db.items.some((i) => i.attachments?.some((a) => a.id === id)) || db.lists.some((l) => l.entries.some((e) => e.photo?.url === url));
  const record = db.attachments.find((a) => a.id === id);
  if (used || !record) return;
  forget([record]);
  db.attachments = db.attachments.filter((a) => a.id !== id);
  save();
}
