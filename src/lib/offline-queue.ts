"use client";

/**
 * Offline photo queue backed by IndexedDB (survives poor signal inside
 * walk-in chillers and dry stores) + client-side image compression.
 */
const DB_NAME = "event-storey-offline";
const STORE = "queued_photos";

export interface QueuedBatch {
  id: string;
  zoneId: string;
  sessionId?: string;
  createdAt: number;
  files: Array<{ name: string; type: string; blob: Blob }>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queuePhotos(batch: Omit<QueuedBatch, "id" | "createdAt">): Promise<QueuedBatch> {
  const db = await openDb();
  const entry: QueuedBatch = { ...batch, id: crypto.randomUUID(), createdAt: Date.now() };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return entry;
}

export async function getQueuedForZone(zoneId: string): Promise<QueuedBatch[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as QueuedBatch[]) ?? [];
      resolve(all.filter((b) => b.zoneId === zoneId).sort((a, b) => a.createdAt - b.createdAt));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedBatch(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Downscale large phone camera photos to max 1600px JPEG for fast upload & clear OCR. */
export async function compressPhoto(file: File | Blob, filename = "shelf.jpg"): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file instanceof File ? file : new File([file], filename, { type: "image/jpeg" });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  if (!blob) return file instanceof File ? file : new File([file], filename, { type: "image/jpeg" });
  return new File([blob], filename.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}

