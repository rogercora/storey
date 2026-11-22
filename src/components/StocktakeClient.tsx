"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandHeader } from "@/components/Brand";
import { ReviewItemCard } from "@/components/ReviewItemCard";
import { compressPhoto, getQueuedForZone, queuePhotos, removeQueuedBatch, type QueuedBatch } from "@/lib/offline-queue";
import type { StocktakeItemDTO } from "@/lib/sessions";

interface PhotoDraft {
  id: string;
  file: File;
  previewUrl: string;
}

interface ItemPatch {
  closed_units: number;
  open_fraction: number;
  hidden_back_units: number;
  reviewed: boolean;
}

const QUALITY_LABELS: Record<string, string> = {
  low_light: "Low light detected — try turning on the torch",
  glare_reflection: "Glare/reflection on packaging",
  blurry: "Photo looks slightly blurry",
  too_far: "Camera is a bit far from shelf labels",
  partially_cropped: "Some boxes may be cut off at the edges",
  condensation_fog: "Condensation or fog on packaging",
};

export function StocktakeClient({
  zone,
  productCount,
  initialSessionId,
  initialItems,
  initialMeta,
}: {
  zone: { id: string; name: string; description: string | null };
  productCount: number;
  initialSessionId: string | null;
  initialItems: StocktakeItemDTO[];
  initialMeta: { image_quality_issues?: string[]; unmatched_tags_seen?: string[] } | null;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [items, setItems] = useState<StocktakeItemDTO[]>(initialItems);
  const [meta, setMeta] = useState(initialMeta);
  const [mode, setMode] = useState<"capture" | "review">(initialItems.length > 0 ? "review" : "capture");

  // Camera & photo capture state
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [online, setOnline] = useState(true);
  const [queuedBatches, setQueuedBatches] = useState<QueuedBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const editsRef = useRef<Map<string, ItemPatch>>(new Map());

  // Seed edits map when items load
  useEffect(() => {
    const map = new Map<string, ItemPatch>();
    for (const it of items) {
      map.set(it.item_id, {
        closed_units: it.final.closed_units,
        open_fraction: it.final.open_fraction,
        hidden_back_units: it.final.hidden_back_units,
        reviewed: it.reviewed || it.status === "confirmed",
      });
    }
    editsRef.current = map;
  }, [items]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const refreshQueue = useCallback(async () => {
    try {
      const q = await getQueuedForZone(zone.id);
      setQueuedBatches(q);
    } catch {
      // IndexedDB unavailable in private browsing
    }
  }, [zone.id]);

  const uploadBatch = useCallback(
    async (files: File[], targetSessionId?: string | null): Promise<boolean> => {
      const form = new FormData();
      form.append("zone_id", zone.id);
      if (targetSessionId) form.append("session_id", targetSessionId);
      for (const f of files.slice(0, 4)) form.append("photos", f);

      const res = await fetch("/api/analyze-shelf", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Analysis failed. Please try again.");
        return false;
      }

      const loadedRes = await fetch(`/api/sessions/${data.session_id}`);
      const loaded = await loadedRes.json();
      if (!loadedRes.ok) {
        setError(loaded?.error ?? "Could not load analysed items.");
        return false;
      }

      setSessionId(data.session_id);
      setItems(loaded.items ?? []);
      setMeta({
        image_quality_issues: data.image_quality_issues,
        unmatched_tags_seen: data.unmatched_tags_seen,
      });
      setMode("review");
      return true;
    },
    [zone.id],
  );

  const flushOfflineQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    const batches = await getQueuedForZone(zone.id);
    if (batches.length === 0) return;

    setBusy(true);
    setNotice("Back online — uploading queued photos…");
    for (const batch of batches) {
      try {
        const files = batch.files.map((f) => new File([f.blob], f.name, { type: f.type }));
        const ok = await uploadBatch(files, batch.sessionId ?? sessionId);
        if (ok) await removeQueuedBatch(batch.id);
      } catch {
        break;
      }
    }
    await refreshQueue();
    setBusy(false);
    setNotice(null);
  }, [zone.id, sessionId, uploadBatch, refreshQueue]);

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    refreshQueue();
    const onOnline = () => {
      setOnline(true);
      flushOfflineQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushOfflineQueue, refreshQueue]);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);

      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchSupported(Boolean(caps?.torch));

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setError("Camera access was blocked. Use 'Upload photo' below instead.");
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setError("Torch is not supported on this device.");
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || photos.length >= 4) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    if (!blob) return;
    const file = await compressPhoto(blob, `shelf-${Date.now()}.jpg`);
    setPhotos((prev) => [...prev.slice(0, 3), { id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) }]);
    stopCamera();
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (chosen.length === 0) return;

    const remaining = 4 - photos.length;
    const compressed: PhotoDraft[] = [];
    for (const raw of chosen.slice(0, remaining)) {
      const file = await compressPhoto(raw, raw.name || "shelf.jpg");
      compressed.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
    }
    setPhotos((prev) => [...prev, ...compressed]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleAnalyse() {
    if (photos.length === 0) return;
    setError(null);
    setNotice(null);
    const files = photos.map((p) => p.file);

    if (!navigator.onLine) {
      await queuePhotos({
        zoneId: zone.id,
        sessionId: sessionId ?? undefined,
        files: files.map((f) => ({ name: f.name, type: f.type, blob: f })),
      });
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPhotos([]);
      await refreshQueue();
      setNotice("Saved offline. Photos will upload automatically when signal returns.");
      return;
    }

    setBusy(true);
    try {
      const ok = await uploadBatch(files, sessionId);
      if (ok) {
        photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        setPhotos([]);
      }
    } catch {
      // Network dropped mid-request -> save to offline queue
      await queuePhotos({
        zoneId: zone.id,
        sessionId: sessionId ?? undefined,
        files: files.map((f) => ({ name: f.name, type: f.type, blob: f })),
      });
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPhotos([]);
      await refreshQueue();
      setNotice("Connection lost — photos queued offline and will retry automatically.");
    } finally {
      setBusy(false);
    }
  }

  async function startManualCount() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_id: zone.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not start manual count.");
        return;
      }
      const loadedRes = await fetch(`/api/sessions/${data.session_id}`);
      const loaded = await loadedRes.json();
      setSessionId(data.session_id);
      setItems(loaded.items ?? []);
      setMode("review");
    } finally {
      setBusy(false);
    }
  }

  async function saveSession(complete: boolean) {
    if (!sessionId) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        complete,
        items: Array.from(editsRef.current.entries()).map(([item_id, v]) => ({
          item_id,
          closed_units: v.closed_units,
          open_fraction: v.open_fraction,
          hidden_back_units: v.hidden_back_units,
          reviewed: complete ? true : v.reviewed,
        })),
      };
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not save stocktake.");
        return;
      }
      if (complete) {
        router.push("/");
        router.refresh();
      } else {
        setNotice("Draft saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  const reviewItems = items.filter((i) => i.status === "needs_review");
  const confirmedItems = items.filter((i) => i.status === "confirmed");
  const unseenItems = items.filter((i) => i.status === "unseen");

  return (
    <div className="min-h-dvh pb-24">
      <BrandHeader
        right={
          <Link href="/" className="chip bg-volt text-ink">
            ← Zones
          </Link>
        }
      />

      <section className="bg-brand px-5 py-6 text-white">
        <p className="text-xs font-bold uppercase tracking-wider text-white/80">
          {productCount} active products
        </p>
        <h1 className="mt-1 text-4xl text-volt">{zone.name}</h1>
        {mode === "review" && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
            <span className="bg-volt px-2.5 py-1 text-ink">{reviewItems.length} to check</span>
            <span className="bg-white px-2.5 py-1 text-ink">{confirmedItems.length} confirmed</span>
            <span className="bg-white/20 px-2.5 py-1">{unseenItems.length} not seen</span>
          </div>
        )}
      </section>

      <main className="mx-auto max-w-md px-4 pt-5">
        {!online && (
          <p className="mb-4 border-2 border-ink bg-warn-light px-3 py-2 text-sm font-bold text-warn">
            You are offline. Photos taken now will queue locally until signal returns.
          </p>
        )}
        {queuedBatches.length > 0 && (
          <div className="mb-4 flex items-center justify-between gap-2 border-2 border-ink bg-warn-light px-3 py-2 text-sm font-bold text-warn">
            <span>{queuedBatches.reduce((n, b) => n + b.files.length, 0)} photo(s) queued offline</span>
            {online && (
              <button type="button" className="underline" onClick={flushOfflineQueue} disabled={busy}>
                Retry now
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="mb-4 border-2 border-accent bg-accent-light px-3 py-2 text-sm font-semibold text-accent" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-4 border-2 border-ok bg-ok-light px-3 py-2 text-sm font-semibold text-ok">{notice}</p>
        )}

        {mode === "capture" ? (
          <div>
            <h2 className="text-3xl">Photograph the shelf</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Keep handwritten box codes (e.g. CP12, CF01) facing the camera. Add up to 4 angles.
            </p>

            {cameraOpen ? (
              <div className="mt-4 space-y-3">
                <div className="relative aspect-[3/4] overflow-hidden border-2 border-ink bg-ink">
                  <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" className="btn-accent" onClick={captureFrame} disabled={photos.length >= 4}>
                    Take photo
                  </button>
                  {torchSupported ? (
                    <button type="button" className="btn-secondary" onClick={toggleTorch}>
                      {torchOn ? "Torch ON" : "Torch OFF"}
                    </button>
                  ) : (
                    <button type="button" className="btn-secondary" onClick={stopCamera}>
                      Close camera
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={photos.length >= 4}
                  className="flex aspect-[4/3] w-full flex-col items-center justify-center border-2 border-dashed border-ink bg-ink text-white active:scale-[0.99]"
                >
                  <span className="font-display text-3xl text-volt">Open camera</span>
                  <span className="mt-1 text-sm text-white/80">Tap to photograph {zone.name}</span>
                </button>

                <label className="btn-secondary w-full cursor-pointer">
                  Upload / Choose photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="sr-only"
                    onChange={handleFileSelect}
                    disabled={photos.length >= 4}
                  />
                </label>
              </div>
            )}

            {photos.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                  Ready to analyse ({photos.length}/4)
                </p>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {photos.map((p) => (
                    <div key={p.id} className="relative aspect-square border-2 border-ink bg-ink">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.previewUrl} alt="Shelf preview" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => removePhoto(p.id)}
                        className="absolute right-0 top-0 bg-ink px-1.5 py-0.5 text-xs font-bold text-volt"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn-accent mt-4 w-full" onClick={handleAnalyse} disabled={busy}>
                  {busy ? "Analysing shelf…" : `Analyse ${photos.length} photo${photos.length > 1 ? "s" : ""}`}
                </button>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2 border-t border-line pt-4">
              {items.length > 0 && (
                <button type="button" className="btn-secondary w-full" onClick={() => setMode("review")}>
                  Back to current review ({items.length} items)
                </button>
              )}
              {!sessionId && (
                <button type="button" className="text-sm font-bold underline" onClick={startManualCount} disabled={busy}>
                  Count manually without a photo
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {meta?.image_quality_issues && meta.image_quality_issues.length > 0 && (
              <div className="border-2 border-ink bg-warn-light p-3 text-sm">
                <p className="font-bold text-warn">Photo quality check:</p>
                <ul className="mt-1 list-disc pl-5 text-warn">
                  {meta.image_quality_issues.map((q) => (
                    <li key={q}>{QUALITY_LABELS[q] ?? q}</li>
                  ))}
                </ul>
              </div>
            )}

            {meta?.unmatched_tags_seen && meta.unmatched_tags_seen.length > 0 && (
              <div className="border-2 border-ink bg-volt/40 p-3 text-sm">
                <p className="font-bold">Unmatched handwritten codes seen:</p>
                <p className="mt-1 font-mono font-bold">{meta.unmatched_tags_seen.join(", ")}</p>
              </div>
            )}

            <button type="button" className="btn-secondary w-full" onClick={() => setMode("capture")}>
              + Add another photo angle
            </button>

            {reviewItems.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-2xl">Check these first</h2>
                {reviewItems.map((it) => (
                  <ReviewItemCard
                    key={it.item_id}
                    itemId={it.item_id}
                    code={it.code_tag}
                    name={it.name}
                    countUnit={it.count_unit}
                    orderUnit={it.order_unit}
                    status={it.status}
                    reasons={it.reasons}
                    evidence={it.evidence}
                    confidence={it.confidence}
                    allowOpenFraction={it.allow_open_fraction}
                    restock={it.restock}
                    initial={{
                      closed: it.final.closed_units,
                      open: it.final.open_fraction,
                      hidden: it.final.hidden_back_units,
                      reviewed: it.reviewed,
                    }}
                    onChange={(v) =>
                      editsRef.current.set(it.item_id, {
                        closed_units: v.closed,
                        open_fraction: v.open,
                        hidden_back_units: v.hidden,
                        reviewed: v.confirmed,
                      })
                    }
                  />
                ))}
              </section>
            )}

            {confirmedItems.length > 0 && (
              <section className="space-y-3 pt-2">
                <h2 className="text-2xl">Confirmed</h2>
                {confirmedItems.map((it) => (
                  <ReviewItemCard
                    key={it.item_id}
                    itemId={it.item_id}
                    code={it.code_tag}
                    name={it.name}
                    countUnit={it.count_unit}
                    orderUnit={it.order_unit}
                    status={it.status}
                    reasons={it.reasons}
                    evidence={it.evidence}
                    confidence={it.confidence}
                    allowOpenFraction={it.allow_open_fraction}
                    restock={it.restock}
                    initial={{
                      closed: it.final.closed_units,
                      open: it.final.open_fraction,
                      hidden: it.final.hidden_back_units,
                      reviewed: it.reviewed,
                    }}
                    onChange={(v) =>
                      editsRef.current.set(it.item_id, {
                        closed_units: v.closed,
                        open_fraction: v.open,
                        hidden_back_units: v.hidden,
                        reviewed: v.confirmed,
                      })
                    }
                  />
                ))}
              </section>
            )}

            {unseenItems.length > 0 && (
              <section className="space-y-3 pt-2">
                <h2 className="text-2xl">Not seen in photo (0)</h2>
                {unseenItems.map((it) => (
                  <ReviewItemCard
                    key={it.item_id}
                    itemId={it.item_id}
                    code={it.code_tag}
                    name={it.name}
                    countUnit={it.count_unit}
                    orderUnit={it.order_unit}
                    status={it.status}
                    reasons={it.reasons}
                    evidence={it.evidence}
                    confidence={it.confidence}
                    allowOpenFraction={it.allow_open_fraction}
                    restock={it.restock}
                    initial={{
                      closed: it.final.closed_units,
                      open: it.final.open_fraction,
                      hidden: it.final.hidden_back_units,
                      reviewed: it.reviewed,
                    }}
                    onChange={(v) =>
                      editsRef.current.set(it.item_id, {
                        closed_units: v.closed,
                        open_fraction: v.open,
                        hidden_back_units: v.hidden,
                        reviewed: v.confirmed,
                      })
                    }
                  />
                ))}
              </section>
            )}

            <div className="grid grid-cols-2 gap-3 pt-4">
              <button type="button" className="btn-secondary" onClick={() => saveSession(false)} disabled={saving}>
                Save draft
              </button>
              <button type="button" className="btn-accent" onClick={() => saveSession(true)} disabled={saving}>
                {saving ? "Saving…" : "Finish stocktake"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

