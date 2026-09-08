// IndexedDB local store (idb helper).
// Stores:
//   fiche_cache : key ficheId -> serialized FicheWithRows (local read source)
//   outbox      : auto-increment seq -> SyncOp (pending writes)
//   conflicts   : key `${ficheId}:${rowUuid}:${cellKey}` -> Conflict (unresolved)
import { openDB, type IDBPDatabase } from "idb";
import type { SyncOp, Conflict } from "@/lib/sync/types";

const DB_NAME = "pm-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function openDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("fiche_cache")) {
          db.createObjectStore("fiche_cache", { keyPath: "ficheId" });
        }
        if (!db.objectStoreNames.contains("outbox")) {
          const outbox = db.createObjectStore("outbox", {
            keyPath: "seq",
            autoIncrement: true,
          });
          // One index on opId for idempotent replays
          outbox.createIndex("opId", "opId", { unique: true });
        }
        if (!db.objectStoreNames.contains("conflicts")) {
          db.createObjectStore("conflicts", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

// ---------- fiche_cache ----------

export type CachedFiche = {
  ficheId: string;
  data: unknown; // FicheWithRows
  savedAt: number;
};

export async function cacheFiche(ficheId: string, data: unknown): Promise<void> {
  const db = await openDb();
  await db.put("fiche_cache", { ficheId, data, savedAt: Date.now() });
}

export async function getCachedFiche<T = unknown>(ficheId: string): Promise<T | null> {
  const db = await openDb();
  const row = (await db.get("fiche_cache", ficheId)) as
    | { ficheId: string; data: T }
    | undefined;
  return row?.data ?? null;
}

export async function clearFicheCache(ficheId: string): Promise<void> {
  const db = await openDb();
  await db.delete("fiche_cache", ficheId);
}

// ---------- outbox ----------

export async function enqueueOp(op: SyncOp): Promise<void> {
  const db = await openDb();
  // Unique opId index guards against double enqueue
  const existing = await db.getFromIndex("outbox", "opId", op.opId);
  if (existing) return;
  await db.add("outbox", { ...op });
}

/** Read pending ops in insertion order (oldest first). */
export async function listOutbox(): Promise<(SyncOp & { seq: number })[]> {
  const db = await openDb();
  return (await db.getAll("outbox")) as (SyncOp & { seq: number })[];
}

export async function countOutbox(): Promise<number> {
  const db = await openDb();
  return db.count("outbox");
}

export async function removeOp(seq: number): Promise<void> {
  const db = await openDb();
  await db.delete("outbox", seq);
}

export async function clearOutbox(): Promise<void> {
  const db = await openDb();
  await db.clear("outbox");
}

// ---------- conflicts ----------

export type ConflictRow = Conflict & { key: string };

export async function putConflict(c: Conflict, ficheId: string): Promise<void> {
  const db = await openDb();
  await db.put("conflicts", { ...c, key: `${ficheId}:${c.rowUuid}:${c.cellKey}` });
}

export async function listConflicts(ficheId?: string): Promise<ConflictRow[]> {
  const db = await openDb();
  const all = (await db.getAll("conflicts")) as ConflictRow[];
  return ficheId ? all.filter((c) => c.key.startsWith(`${ficheId}:`)) : all;
}

export async function removeConflict(key: string): Promise<void> {
  const db = await openDb();
  await db.delete("conflicts", key);
}
