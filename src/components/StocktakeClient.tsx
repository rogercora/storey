"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandHeader } from "@/components/Brand";
import { ReviewItemCard } from "@/components/ReviewItemCard";
import { ProductFormModal, type CategoryOption, type EditableProduct, type SupplierOption, type ZoneOption } from "@/components/ProductFormModal";
import { compressPhoto, getQueuedForZone, queuePhotos, removeQueuedBatch, type QueuedBatch } from "@/lib/offline-queue";
import { formatUkDateTime } from "@/lib/dates";
import { formatGBP } from "@/lib/numbers";
import { computeRestock } from "@/lib/restock";
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
  zones,
  categories,
  initialSuppliers,
  initialProductCount,
  initialSessionId,
  initialSessionOwner,
  initialSessionCreatedAt,
  lastCompleted,
  initialItems,
  initialMeta,
}: {
  zone: { id: string; name: string; description: string | null };
  zones: ZoneOption[];
  categories?: CategoryOption[];
  initialSuppliers: SupplierOption[];
  initialProductCount: number;
  initialSessionId: string | null;
  initialSessionOwner: string | null;
  initialSessionCreatedAt: string | null;
  lastCompleted: { by: string; at: string } | null;
  initialItems: StocktakeItemDTO[];
  initialMeta: { image_quality_issues?: string[]; unmatched_tags_seen?: string[] } | null;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [sessionOwner, setSessionOwner] = useState<string | null>(initialSessionOwner);
  const [sessionCreatedAt, setSessionCreatedAt] = useState<string | null>(initialSessionCreatedAt);
  const [items, setItems] = useState<StocktakeItemDTO[]>(initialItems);
  const [productCount, setProductCount] = useState(initialProductCount);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(initialSuppliers);
  const [meta, setMeta] = useState(initialMeta);
  const [mode, setMode] = useState<"capture" | "review">(initialItems.length > 0 ? "review" : "capture");

  // Modal state for adding/editing a product inside the zone
  const [productModal, setProductModal] = useState<
    | { open: false }
    | { open: true; mode: "create" }
    | { open: true; mode: "edit"; product: EditableProduct }
  >({ open: false });

  // Camera & photo capture state
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [streamVersion, setStreamVersion] = useState(0);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [online, setOnline] = useState(true);
  const [queuedBatches, setQueuedBatches] = useState<QueuedBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editsVersion, setEditsVersion] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const editsRef = useRef<Map<string, ItemPatch>>(new Map());

  // Keep edits map in sync with items without clobbering existing edits
  useEffect(() => {
    const next = new Map(editsRef.current);
    for (const it of items) {
      if (!next.has(it.item_id)) {
        next.set(it.item_id, {
          closed_units: it.final.closed_units,
          open_fraction: it.final.open_fraction,
          hidden_back_units: it.final.hidden_back_units,
          reviewed: it.reviewed || it.status === "confirmed",
        });
      }
    }
    editsRef.current = next;
    setEditsVersion((v) => v + 1);
  }, [items]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
    setCameraStarting(false);
    setVideoReady(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onHide = () => {
      if (document.visibilityState === "hidden") stopCamera();
    };
    window.addEventListener("pagehide", stopCamera);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", stopCamera);
      document.removeEventListener("visibilitychange", onHide);
      stopCamera();
    };
  }, [stopCamera]);

  // Attach MediaStream only after React mounts the <video> element in the DOM.
  useEffect(() => {
    if (!cameraOpen) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.setAttribute("playsinline", "true");
    video.muted = true;
    video.srcObject = stream;

    const markReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoReady(true);
      }
    };

    video.addEventListener("loadedmetadata", markReady);
    video.addEventListener("canplay", markReady);
    video.addEventListener("playing", markReady);
    video.play().then(markReady).catch(() => {});
    if (video.readyState >= 2) markReady();

    return () => {
      video.removeEventListener("loadedmetadata", markReady);
      video.removeEventListener("canplay", markReady);
      video.removeEventListener("playing", markReady);
    };
  }, [cameraOpen, streamVersion]);

  const refreshQueue = useCallback(async () => {
    try {
      const q = await getQueuedForZone(zone.id);
      setQueuedBatches(q);
    } catch {
      // IndexedDB unavailable
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

      editsRef.current = new Map();
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

  async function openStreamWithRetry(): Promise<MediaStream> {
    const candidates: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: "environment" }, audio: false },
      { video: true, audio: false },
    ];

    let lastErr: unknown;
    for (let i = 0; i < candidates.length; i++) {
      try {
        return await navigator.mediaDevices.getUserMedia(candidates[i]!);
      } catch (err) {
        lastErr = err;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") throw err;
        // Mobile camera HALs often need ~300ms right after first OS permission grant.
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw lastErr;
  }

  async function startCamera() {
    if (cameraStarting) return;
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Live camera preview is not supported in this browser. Use 'Use phone camera' below instead.");
      return;
    }

    // Release any lingering hardware lock before acquiring a fresh stream.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setVideoReady(false);
    setCameraStarting(true);

    try {
      const stream = await openStreamWithRetry();
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          if (mountedRef.current) stopCamera();
        };
      }
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchSupported(Boolean(caps?.torch));
      setStreamVersion((v) => v + 1);
      setCameraOpen(true);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Camera permission was blocked. Allow camera access in your browser settings or use 'Use phone camera' below.");
      } else {
        setError("Camera could not start right away. Tap 'Open camera' again or use 'Use phone camera' below.");
      }
    } finally {
      if (mountedRef.current) setCameraStarting(false);
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
    if (!video.videoWidth || !video.videoHeight) {
      setError("Camera is still starting — please wait a moment and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
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
      editsRef.current = new Map();
      setSessionId(data.session_id);
      setSessionCreatedAt(new Date().toISOString());
      setSessionOwner("You");
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

  // Running total estimated restock value in GBP (£)
  void editsVersion;
  const estOrderTotal = items.reduce((sum, it) => {
    const patch = editsRef.current.get(it.item_id);
    const closed = patch?.closed_units ?? it.final.closed_units;
    const open = patch?.open_fraction ?? it.final.open_fraction;
    const hidden = patch?.hidden_back_units ?? it.final.hidden_back_units;
    return sum + computeRestock(it.restock, closed + open + hidden).estimated_cost_gbp;
  }, 0);

  function openEditModal(it: StocktakeItemDTO) {
    setProductModal({
      open: true,
      mode: "edit",
      product: {
        id: it.product_id,
        zone_id: zone.id,
        supplier_id: it.supplier_id,
        code_tag: it.code_tag,
        name: it.name,
        brand: it.brand,
        category: it.category,
        visual_hints: it.visual_hints,
        has_handwritten_tag: it.has_handwritten_tag,
        count_unit: it.count_unit,
        order_unit: it.order_unit,
        conversion_factor: it.restock.conversion_factor,
        allow_open_fraction: it.allow_open_fraction,
        min_stock: it.restock.min_stock,
        target_stock: it.restock.target_stock,
        safety_margin: it.restock.safety_margin,
        round_up_order: it.restock.round_up_order,
        unit_cost_gbp: it.restock.unit_cost_gbp,
      },
    });
  }

  function renderCard(it: StocktakeItemDTO) {
    return (
      <ReviewItemCard
        key={`${it.item_id}-${it.restock.unit_cost_gbp}-${it.restock.target_stock}`}
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
          closed: editsRef.current.get(it.item_id)?.closed_units ?? it.final.closed_units,
          open: editsRef.current.get(it.item_id)?.open_fraction ?? it.final.open_fraction,
          hidden: editsRef.current.get(it.item_id)?.hidden_back_units ?? it.final.hidden_back_units,
          reviewed: editsRef.current.get(it.item_id)?.reviewed ?? it.reviewed,
        }}
        onChange={(v) => {
          editsRef.current.set(it.item_id, {
            closed_units: v.closed,
            open_fraction: v.open,
            hidden_back_units: v.hidden,
            reviewed: v.confirmed,
          });
          setEditsVersion((n) => n + 1);
        }}
        onEditProduct={() => openEditModal(it)}
      />
    );
  }

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

        {sessionId && sessionOwner && sessionCreatedAt && (
          <p className="mt-2 text-xs font-semibold text-white/90">
            Draft started by {sessionOwner} · {formatUkDateTime(sessionCreatedAt)}
          </p>
        )}
        {!sessionId && lastCompleted && (
          <p className="mt-2 text-xs font-semibold text-white/90">
            Last completed by {lastCompleted.by} · {formatUkDateTime(lastCompleted.at)}
          </p>
        )}

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
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-3xl">Photograph the shelf</h2>
              <button
                type="button"
                className="chip bg-ink px-3 py-1.5 text-volt"
                onClick={() => setProductModal({ open: true, mode: "create" })}
              >
                + Add product
              </button>
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              Keep handwritten box codes (e.g. CP12, CF01) facing the camera. Add up to 4 angles.
            </p>

            {cameraOpen ? (
              <div className="mt-4 space-y-3">
                <div className="relative aspect-[3/4] overflow-hidden border-2 border-ink bg-ink">
                  <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                  {!videoReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-ink/80 text-sm font-semibold text-white">
                      Starting camera…
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="btn-accent"
                    onClick={captureFrame}
                    disabled={photos.length >= 4 || !videoReady}
                  >
                    {videoReady ? "Take photo" : "Starting…"}
                  </button>
                  <button type="button" className="btn-secondary" onClick={stopCamera}>
                    Close camera
                  </button>
                </div>
                {torchSupported && (
                  <button type="button" className="btn-secondary w-full" onClick={toggleTorch}>
                    {torchOn ? "Torch ON" : "Torch OFF"}
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={photos.length >= 4 || cameraStarting}
                  className="flex aspect-[4/3] w-full flex-col items-center justify-center border-2 border-dashed border-ink bg-ink text-white active:scale-[0.99]"
                >
                  <span className="font-display text-3xl text-volt">
                    {cameraStarting ? "Opening camera…" : "Open camera"}
                  </span>
                  <span className="mt-1 text-sm text-white/80">Tap to photograph {zone.name}</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <label className="btn-secondary w-full cursor-pointer text-center text-sm">
                    Use phone camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={handleFileSelect}
                      disabled={photos.length >= 4}
                    />
                  </label>
                  <label className="btn-secondary w-full cursor-pointer text-center text-sm">
                    Choose from gallery
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={handleFileSelect}
                      disabled={photos.length >= 4}
                    />
                  </label>
                </div>
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
                <button type="button" className="btn-primary w-full" onClick={startManualCount} disabled={busy}>
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

            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary !px-3 text-base" onClick={() => setMode("capture")}>
                + Add photo
              </button>
              <button
                type="button"
                className="btn-primary !px-3 text-base"
                onClick={() => setProductModal({ open: true, mode: "create" })}
              >
                + Add product
              </button>
            </div>

            {reviewItems.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-2xl">Check these first</h2>
                {reviewItems.map(renderCard)}
              </section>
            )}

            {confirmedItems.length > 0 && (
              <section className="space-y-3 pt-2">
                <h2 className="text-2xl">Confirmed</h2>
                {confirmedItems.map(renderCard)}
              </section>
            )}

            {unseenItems.length > 0 && (
              <section className="space-y-3 pt-2">
                <h2 className="text-2xl">Not seen in photo (0)</h2>
                {unseenItems.map(renderCard)}
              </section>
            )}

            <div className="border-2 border-ink bg-card p-3 text-center">
              <p className="text-xs font-bold uppercase text-ink-soft">Estimated restock value for {zone.name}</p>
              <p className="font-display text-3xl text-brand">{formatGBP(estOrderTotal)}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
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

      {productModal.open && (
        <ProductFormModal
          mode={productModal.mode}
          zones={zones}
          defaultZoneId={zone.id}
          categories={categories}
          suppliers={suppliers}
          sessionId={sessionId}
          product={productModal.mode === "edit" ? productModal.product : null}
          onClose={() => setProductModal({ open: false })}
          onSaved={({ product, supplier, sessionItem }) => {
            if (supplier && !suppliers.some((s) => s.id === supplier.id)) {
              setSuppliers((prev) => [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)));
            }
            if (productModal.mode === "create") {
              if (product.zone_id === zone.id) setProductCount((c) => c + 1);
              if (sessionItem) {
                setItems((prev) => [sessionItem, ...prev]);
                setMode("review");
              }
              setNotice(`Added [${product.code_tag}] ${product.name} (${formatGBP(Number(product.unit_cost_gbp))}).`);
            } else {
              setItems((prev) =>
                prev.map((it) =>
                  it.product_id === product.id
                    ? {
                        ...it,
                        name: product.name,
                        brand: product.brand,
                        category: product.category,
                        supplier_id: product.supplier_id,
                        visual_hints: product.visual_hints,
                        has_handwritten_tag: product.has_handwritten_tag,
                        count_unit: product.count_unit,
                        order_unit: product.order_unit,
                        allow_open_fraction: product.allow_open_fraction,
                        restock: {
                          target_stock: Number(product.target_stock),
                          safety_margin: Number(product.safety_margin),
                          min_stock: Number(product.min_stock),
                          conversion_factor: Number(product.conversion_factor),
                          round_up_order: Boolean(product.round_up_order),
                          unit_cost_gbp: Number(product.unit_cost_gbp),
                        },
                      }
                    : it,
                ),
              );
              setNotice(`Updated [${product.code_tag}] ${product.name} (${formatGBP(Number(product.unit_cost_gbp))}).`);
            }
            setProductModal({ open: false });
          }}
        />
      )}
    </div>
  );
}
