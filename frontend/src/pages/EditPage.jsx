import { useState, useEffect, useRef, useMemo } from "react";
import JSZip from "jszip";
import FilterCard from "../components/FilterCard";
import { applyParams, batchApply, sendFeedback } from "../api";
import { renderPreview } from "../utils/canvasPreview";

const FINE_GROUPS = [
  {
    label: "Light",
    params: [
      { key: "exposure",   label: "Exposure",   min: -1.5, max: 1.5, step: 0.05 },
      { key: "contrast",   label: "Contrast",   min: -40,  max: 40,  step: 1 },
      { key: "highlights", label: "Highlights", min: -40,  max: 40,  step: 1 },
      { key: "shadows",    label: "Shadows",    min: -40,  max: 40,  step: 1 },
      { key: "whites",     label: "Whites",     min: -30,  max: 30,  step: 1 },
      { key: "blacks",     label: "Blacks",     min: -30,  max: 30,  step: 1 },
    ],
  },
  {
    label: "Color",
    params: [
      { key: "temperature", label: "Temperature", min: -40, max: 40, step: 1 },
      { key: "tint",        label: "Tint",        min: -20, max: 20, step: 1 },
      { key: "vibrance",    label: "Vibrance",    min: -30, max: 30, step: 1 },
      { key: "saturation",  label: "Saturation",  min: -30, max: 30, step: 1 },
    ],
  },
  {
    label: "Detail",
    params: [
      { key: "sharpness",       label: "Sharpness",       min: -20, max: 40, step: 1 },
      { key: "noise_reduction", label: "Noise Reduction", min: -10, max: 30, step: 1 },
    ],
  },
];

const MANUAL_GROUPS = [
  {
    label: "Light",
    params: [
      { key: "exposure",   label: "Exposure",   min: -3,   max: 3,   step: 0.05 },
      { key: "contrast",   label: "Contrast",   min: -100, max: 100, step: 1 },
      { key: "highlights", label: "Highlights", min: -100, max: 100, step: 1 },
      { key: "shadows",    label: "Shadows",    min: -100, max: 100, step: 1 },
      { key: "whites",     label: "Whites",     min: -100, max: 100, step: 1 },
      { key: "blacks",     label: "Blacks",     min: -100, max: 100, step: 1 },
    ],
  },
  {
    label: "Color",
    params: [
      { key: "temperature", label: "Temperature", min: -100, max: 100, step: 1 },
      { key: "tint",        label: "Tint",        min: -100, max: 100, step: 1 },
      { key: "vibrance",    label: "Vibrance",    min: -100, max: 100, step: 1 },
      { key: "saturation",  label: "Saturation",  min: -100, max: 100, step: 1 },
    ],
  },
  {
    label: "Detail",
    params: [
      { key: "sharpness",       label: "Sharpness",       min: 0, max: 150, step: 1 },
      { key: "noise_reduction", label: "Noise Reduction", min: 0, max: 100, step: 1 },
    ],
  },
];

const QUICK_FEEDBACK = [
  { key: "brighter",       label: "Brighter" },
  { key: "darker",         label: "Darker" },
  { key: "warmer",         label: "Warmer" },
  { key: "cooler",         label: "Cooler" },
  { key: "more_contrast",  label: "More contrast" },
  { key: "less_contrast",  label: "Less contrast" },
  { key: "more_saturated", label: "More color" },
  { key: "less_saturated", label: "Less color" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sharpnessCss(params) {
  const nr = (params.noise_reduction ?? 0) / 100 * 1.5;
  return nr > 0 ? `blur(${nr.toFixed(2)}px)` : "none";
}

async function fetchBlob(url) {
  const r = await fetch(url);
  return r.blob();
}

function saveBlobAs(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/** ④ Pack an array of { blob, filename } into a single ZIP blob via JSZip. */
async function buildZip(entries) {
  const zip = new JSZip();
  for (const { blob, filename } of entries) zip.file(filename, blob);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } });
}

// ─── ② Scroll Preview Strip ──────────────────────────────────────────────────

// Renders a thumbnail via the same Canvas pipeline as the main preview.
// Caches the blob by (src + JSON params) — only re-renders when params change.
function ThumbCanvas({ src, params, className }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const cacheKeyRef = useRef(null);
  const prevBlobRef = useRef(null);

  useEffect(() => {
    const key = src + JSON.stringify(params);
    if (cacheKeyRef.current === key) return;
    cacheKeyRef.current = key;
    let cancelled = false;
    renderPreview(src, params).then((url) => {
      if (cancelled) { URL.revokeObjectURL(url); return; }
      if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
      prevBlobRef.current = url;
      setBlobUrl(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [src, params]);

  return (
    <img
      src={blobUrl ?? src}
      alt=""
      className={className}
      style={{ opacity: blobUrl ? 1 : 0.5, transition: "opacity 0.15s" }}
    />
  );
}

function ScrollPreview({ images, activeIdx, getParams, onSelect, perImageDelta }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 px-0.5" style={{ scrollbarWidth: "thin" }}>
      {images.map((img, i) => {
        const hasCustom = perImageDelta[i] && Object.keys(perImageDelta[i]).length > 0;
        return (
          <div
            key={i}
            onClick={() => onSelect(i)}
            className={`relative flex-none cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
              activeIdx === i
                ? "border-blue-500 shadow-lg shadow-blue-500/20"
                : "border-gray-700 hover:border-gray-500"
            }`}
          >
            <ThumbCanvas
              src={img.url}
              params={getParams(i)}
              className="w-40 h-28 object-cover block"
            />
            {/* orange dot = per-image custom adjustments exist */}
            {hasCustom && (
              <span
                className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 block"
                title="Custom adjustments"
              />
            )}
            {activeIdx === i && (
              <span className="absolute top-1.5 left-1.5 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded font-medium">
                Editing
              </span>
            )}
            <div className="bg-gray-900 px-2 py-1 text-xs text-gray-400 flex justify-between">
              <span>Photo {i + 1}</span>
              {hasCustom && <span className="text-amber-400">custom</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main EditPage ────────────────────────────────────────────────────────────

export default function EditPage({ images, sessionId, condition, candidates, onBack }) {
  const isManual = condition === "manual";
  const isBatch  = images.length > 1;

  // Shared filter + per-card intensities (unchanged from original)
  const [selectedIdx,  setSelectedIdx]  = useState(isManual ? null : 0);
  const [intensities,  setIntensities]  = useState([100, 100, 100]);
  const [showFine,     setShowFine]     = useState(isManual);
  const [applying,     setApplying]     = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  // ③ which image is focused in the scroll strip
  const [activeImgIdx, setActiveImgIdx] = useState(0);

  // ③ per-image fine-tune deltas  { imgIndex: { paramKey: number } }
  const [perImageDelta, setPerImageDelta] = useState({});

  // Canvas preview for the active image
  const [previewUrl, setPreviewUrl] = useState(null);
  const prevBlobRef = useRef(null);

  // ── Compute effective params for any image (shared filter × intensity + per-image delta) ──
  function getEffectiveParams(imgIdx) {
    const base  = (!isManual && selectedIdx !== null) ? (candidates[selectedIdx]?.params ?? {}) : {};
    const scale = (!isManual && selectedIdx !== null) ? intensities[selectedIdx] / 100 : 1;
    const result = {};
    for (const [k, v] of Object.entries(base)) result[k] = (v ?? 0) * scale;
    const delta = perImageDelta[imgIdx] ?? {};
    for (const [k, v] of Object.entries(delta)) result[k] = (result[k] ?? 0) + v;
    return result;
  }

  const activeParams = useMemo(
    () => getEffectiveParams(activeImgIdx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isManual, selectedIdx, candidates, intensities, perImageDelta, activeImgIdx]
  );

  const hasPreview  = isManual || selectedIdx !== null;
  const activeImage = images[activeImgIdx];
  const activeDelta = perImageDelta[activeImgIdx] ?? {};

  // ── Canvas preview debounced 80 ms ──
  useEffect(() => {
    if (!hasPreview) return;
    const timer = setTimeout(async () => {
      try {
        const url = await renderPreview(activeImage.url, activeParams);
        if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
        prevBlobRef.current = url;
        setPreviewUrl(url);
      } catch (e) { console.error(e); }
    }, 80);
    return () => clearTimeout(timer);
  }, [activeParams, activeImage.url, hasPreview]);

  useEffect(() => {
    if (!isManual && candidates.length > 0 && selectedIdx === null) setSelectedIdx(0);
  }, [candidates]); // eslint-disable-line

  useEffect(() => {
    setSelectedIdx(isManual ? null : 0);
    setPerImageDelta({});
    setShowFine(isManual);
    setPreviewUrl(null);
    setActiveImgIdx(0);
  }, [condition, isManual]);

  // ── Handlers ──

  function selectCard(idx) {
    setSelectedIdx(idx);
    setPerImageDelta({});   // changing the global filter clears all per-image deltas
    setPreviewUrl(null);
  }

  function setIntensity(idx, val) {
    setIntensities((prev) => prev.map((v, i) => (i === idx ? val : v)));
  }

  // ③ write delta for the active image only
  function setActiveDelta(key, val) {
    setPerImageDelta((prev) => ({
      ...prev,
      [activeImgIdx]: { ...(prev[activeImgIdx] ?? {}), [key]: val },
    }));
  }

  function resetActiveDelta() {
    setPerImageDelta((prev) => ({ ...prev, [activeImgIdx]: {} }));
  }

  function selectImage(idx) {
    setActiveImgIdx(idx);
    setPreviewUrl(null);
  }

  // ① Batch apply: copy active image's delta to ALL images
  function handleBatchApply() {
    const sourceDelta = perImageDelta[activeImgIdx] ?? {};
    const next = {};
    for (let i = 0; i < images.length; i++) {
      next[i] = { ...sourceDelta };
    }
    setPerImageDelta(next);
  }

  async function handleFeedback(direction) {
    if (!activeImage || feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      const { params } = await sendFeedback(
        activeImage.imageId,
        activeParams,
        direction,
        sessionId
      );
      if (params) {
        // store feedback result as delta for this image only
        setPerImageDelta((prev) => ({ ...prev, [activeImgIdx]: params }));
        setShowFine(true);
      }
    } finally {
      setFeedbackBusy(false);
    }
  }

  // ④ Download — ZIP for batch, single file for one image
  async function handleDownload() {
    setApplying(true);
    try {
      if (!isBatch) {
        const { result_url } = await applyParams(activeImage.imageId, activeParams, sessionId);
        if (result_url) {
          saveBlobAs(await fetchBlob(result_url), "phototune.jpg");
        }
        return;
      }

      // Apply each image with its own effective params, collect blobs, then ZIP
      const entries = [];
      for (let i = 0; i < images.length; i++) {
        const { result_url } = await applyParams(
          images[i].imageId,
          getEffectiveParams(i),
          sessionId
        );
        if (result_url) {
          entries.push({ blob: await fetchBlob(result_url), filename: `phototune_${i + 1}.jpg` });
        }
      }
      if (entries.length > 0) {
        saveBlobAs(await buildZip(entries), "phototune_edited.zip");
      }
    } finally {
      setApplying(false);
    }
  }

  const groups = isManual ? MANUAL_GROUPS : FINE_GROUPS;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">

      {/* Top bar — unchanged */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-white">
          Back
        </button>
        <div className="flex items-center gap-3">
          {isBatch && (
            <span className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded">
              {images.length} photos batch
            </span>
          )}
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded capitalize">
            {condition.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* AI mode: filter cards — unchanged */}
      {!isManual && candidates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {candidates.map((c, i) => (
            <FilterCard
              key={i}
              candidate={c}
              originalUrl={activeImage.url}
              selected={selectedIdx === i}
              intensity={intensities[i]}
              onSelect={() => selectCard(i)}
              onIntensityChange={(v) => setIntensity(i, v)}
            />
          ))}
        </div>
      )}

      {/* ② Scroll preview strip */}
      {isBatch && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">All photos</p>
            <p className="text-xs text-gray-600">tap to fine-tune individually</p>
          </div>
          <ScrollPreview
            images={images}
            activeIdx={activeImgIdx}
            getParams={getEffectiveParams}
            onSelect={selectImage}
            perImageDelta={perImageDelta}
          />
        </div>
      )}

      {/* ① Batch apply banner */}
      {isBatch && !isManual && selectedIdx !== null && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-blue-800 bg-blue-950/30 px-4 py-3">
          <div>
            <p className="text-sm text-white font-medium">Batch apply to all photos</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Sync current filter &amp; intensity to all {images.length} photos — clears per-photo adjustments
            </p>
          </div>
          <button
            onClick={handleBatchApply}
            className="flex-none bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Apply to all
          </button>
        </div>
      )}

      {/* Before / After — tracks the active image from the strip */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {previewUrl
              ? isBatch ? `Photo ${activeImgIdx + 1} — Preview` : "Preview"
              : hasPreview ? "Rendering..." : "Select a filter above"}
          </p>
          <p className="text-xs text-gray-600">
            {isManual
              ? "Editing from original"
              : selectedIdx !== null
                ? `${candidates[selectedIdx]?.name} / ${intensities[selectedIdx]}%`
                : "Custom feedback edit"}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs text-gray-600 text-center">Original</p>
            <div className="aspect-video rounded-lg overflow-hidden bg-gray-900">
              <img src={activeImage.url} alt="original" className="w-full h-full object-contain" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-gray-600 text-center">Edited</p>
            <div className="aspect-video rounded-lg overflow-hidden bg-gray-900">
              <img
                src={previewUrl ?? activeImage.url}
                alt="preview"
                className="w-full h-full object-contain"
                style={{
                  opacity: previewUrl ? 1 : 0.3,
                  filter: sharpnessCss(activeParams),
                  transition: "opacity 0.15s",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Fine-tune / Manual sliders — ③ writes to activeDelta (per image) */}
      {hasPreview && (
        <div className="bg-gray-900 rounded-lg p-5 flex flex-col gap-5">
          {isBatch && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Adjustments apply to <span className="text-white font-medium">Photo {activeImgIdx + 1}</span> only
              </p>
              <button
                onClick={resetActiveDelta}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Reset this photo
              </button>
            </div>
          )}

          {/* Quick feedback chips — unchanged */}
          {!isManual && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {QUICK_FEEDBACK.map((item) => (
                <button
                  key={item.key}
                  onClick={() => handleFeedback(item.key)}
                  disabled={feedbackBusy}
                  className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 text-sm px-3 py-2 rounded transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {!isManual && (
            <button
              onClick={() => setShowFine((v) => !v)}
              className="text-sm text-blue-400 hover:text-blue-300 text-left"
            >
              {showFine ? "Hide adjustments" : "Further adjustments"}
            </button>
          )}

          {isManual && (
            <p className="text-xs text-gray-500">Adjust sliders; preview updates in real time</p>
          )}

          {(showFine || isManual) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {groups.map((group) => (
                <div key={group.label} className="flex flex-col gap-4">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                    {group.label}
                  </p>
                  {group.params.map(({ key, label, min, max, step }) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-400">{label}</span>
                        <span className="text-xs text-gray-500">
                          {step < 1
                            ? Number(activeDelta[key] ?? 0).toFixed(2)
                            : (activeDelta[key] ?? 0)}
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={activeDelta[key] ?? 0}
                          onChange={(e) => setActiveDelta(key, parseFloat(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                        <div className="absolute top-0 left-1/2 -translate-x-px w-px h-2.5 bg-gray-600 pointer-events-none" />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ④ Download — ZIP for batch */}
      {hasPreview && (
        <button
          onClick={handleDownload}
          disabled={applying}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40
            text-white font-semibold py-3.5 rounded transition-colors"
        >
          {applying
            ? "Processing…"
            : isBatch
              ? `Download all ${images.length} photos as ZIP`
              : "Download"}
        </button>
      )}

    </div>
  );
}
