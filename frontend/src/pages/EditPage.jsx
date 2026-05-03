import { useState, useEffect, useRef, useCallback } from "react";
import FilterCard from "../components/FilterCard";
import { applyParams, batchApply, sendFeedback } from "../api";
import { renderPreview } from "../utils/canvasPreview";

// ─── Param definitions ───────────────────────────────────────────────────────
const FINE_GROUPS = [
  {
    label: "Light",
    params: [
      { key: "exposure",   label: "Exposure",   min: -1.5, max: 1.5,  step: 0.05 },
      { key: "contrast",   label: "Contrast",   min: -40,  max: 40,   step: 1 },
      { key: "highlights", label: "Highlights", min: -40,  max: 40,   step: 1 },
      { key: "shadows",    label: "Shadows",    min: -40,  max: 40,   step: 1 },
      { key: "whites",     label: "Whites",     min: -30,  max: 30,   step: 1 },
      { key: "blacks",     label: "Blacks",     min: -30,  max: 30,   step: 1 },
    ],
  },
  {
    label: "Color",
    params: [
      { key: "temperature", label: "Temperature", min: -40, max: 40,  step: 1 },
      { key: "tint",        label: "Tint",        min: -20, max: 20,  step: 1 },
      { key: "vibrance",    label: "Vibrance",    min: -30, max: 30,  step: 1 },
      { key: "saturation",  label: "Saturation",  min: -30, max: 30,  step: 1 },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
function cssFilter(params, intensity) {
  const s = intensity / 100;
  const brightness = Math.pow(2, (params.exposure ?? 0) * s).toFixed(3);
  const contrast   = (1 + ((params.contrast   ?? 0) * s) / 100).toFixed(3);
  const saturate   = Math.max(0, 1 + ((params.saturation ?? 0) * s) / 100).toFixed(3);
  const temp       = (params.temperature ?? 0) * s;
  const sepia      = Math.min(1, Math.abs(temp) / 500).toFixed(3);
  const hue        = ((temp > 0 ? -3 : 3) * Math.abs(temp / 100)).toFixed(1);
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) sepia(${sepia}) hue-rotate(${hue}deg)`;
}

function sharpnessCss(params) {
  const nr = (params.noise_reduction ?? 0) / 100 * 1.5;
  return nr > 0 ? `blur(${nr.toFixed(2)}px)` : "none";
}

async function fetchBlob(url) {
  const resp = await fetch(url);
  return resp.blob();
}

function saveBlobAs(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function buildZip(entries) {
  // entries: [{ blob, filename }]
  // Uses JSZip loaded via CDN script tag (window.JSZip)
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error("JSZip not loaded — add <script src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'></script> to index.html");
  const zip = new JSZip();
  for (const { blob, filename } of entries) {
    zip.file(filename, blob);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } });
}

// ─── Scroll Preview Strip ─────────────────────────────────────────────────────
function ScrollPreview({ images, selectedIdx, getParams, onSelect, perImageDelta }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 px-1" style={{ scrollbarWidth: "thin" }}>
      {images.map((img, i) => {
        const params = getParams(i);
        const hasCustom = perImageDelta[i] && Object.keys(perImageDelta[i]).length > 0;
        return (
          <div
            key={img.imageId ?? i}
            onClick={() => onSelect(i)}
            className={`flex-none cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
              selectedIdx === i
                ? "border-blue-500 shadow-lg shadow-blue-500/20"
                : "border-gray-700 hover:border-gray-500"
            }`}
          >
            <div className="relative w-40">
              <img
                src={img.url}
                alt={`Photo ${i + 1}`}
                className="w-40 h-28 object-cover block"
                style={{ filter: cssFilter(params, 100) }}
              />
              {hasCustom && (
                <span className="absolute top-1.5 left-1.5 bg-amber-500 rounded-full w-2 h-2 block" title="Custom adjustments" />
              )}
              {selectedIdx === i && (
                <span className="absolute top-1.5 right-1.5 bg-blue-500 rounded-full px-1.5 py-0.5 text-xs font-medium">
                  Editing
                </span>
              )}
            </div>
            <div className="bg-gray-900 px-2 py-1 text-xs text-gray-400 flex justify-between">
              <span>Photo {i + 1}</span>
              {hasCustom && <span className="text-amber-400">customised</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Per-image fine tune sliders ──────────────────────────────────────────────
function FineTunePanel({ groups, delta, onChange, onReset, isManual }) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {isManual ? "Adjust sliders — preview updates in real time" : "Fine-tune this photo individually"}
        </p>
        <button
          onClick={onReset}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          Reset
        </button>
      </div>
      <div className="grid grid-cols-3 gap-6">
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
                    {step < 1 ? Number(delta[key] ?? 0).toFixed(2) : (delta[key] ?? 0)}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={delta[key] ?? 0}
                    onChange={(e) => onChange(key, parseFloat(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                  <div className="absolute top-0 left-1/2 -translate-x-px w-px h-2.5 bg-gray-600 pointer-events-none" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Batch Apply Banner ───────────────────────────────────────────────────────
function BatchBanner({ imageCount, onApply }) {
  const [applied, setApplied] = useState(false);

  function handleApply() {
    onApply();
    setApplied(true);
    setTimeout(() => setApplied(false), 1800);
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-4 transition-colors ${
        applied
          ? "border-green-700 bg-green-950/40"
          : "border-blue-800 bg-blue-950/30"
      }`}
    >
      <div>
        <p className="text-sm text-white font-medium">
          {applied ? "✓ Applied to all photos" : "Batch apply to all photos"}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          Current filter + adjustments → all {imageCount} photos (clears per-photo customisations)
        </p>
      </div>
      <button
        onClick={handleApply}
        disabled={applied}
        className="flex-none bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        Apply to all
      </button>
    </div>
  );
}

// ─── Main EditPage ────────────────────────────────────────────────────────────
export default function EditPage({ images, sessionId, condition, candidates, setCandidates, onBack }) {
  const isManual = condition === "manual";

  // Filter / intensity state (shared across all images in AI mode)
  const [selectedFilterIdx, setSelectedFilterIdx] = useState(isManual ? null : 0);
  const [intensity,         setIntensity]          = useState(100);

  // Per-image delta sliders  { imageIndex: { key: value } }
  const [perImageDelta, setPerImageDelta] = useState({});

  // Which image is selected in the scroll strip
  const [activeImgIdx, setActiveImgIdx] = useState(0);

  // Preview blobs for the active image
  const [previewUrl, setPreviewUrl] = useState(null);
  const prevBlobRef = useRef(null);

  const [applying, setApplying] = useState(false);

  // ── Compute effective params for a given image ──
  const getEffectiveParams = useCallback(
    (imgIdx) => {
      const base  = (!isManual && selectedFilterIdx !== null)
        ? (candidates[selectedFilterIdx]?.params ?? {})
        : {};
      const scale = (!isManual && selectedFilterIdx !== null) ? intensity / 100 : 1;
      const result = {};
      for (const [k, v] of Object.entries(base)) result[k] = (v ?? 0) * scale;
      const delta = perImageDelta[imgIdx] ?? {};
      for (const [k, v] of Object.entries(delta)) result[k] = (result[k] ?? 0) + v;
      return result;
    },
    [isManual, selectedFilterIdx, candidates, intensity, perImageDelta]
  );

  // ── Canvas preview for active image (debounced 80ms) ──
  useEffect(() => {
    const params = getEffectiveParams(activeImgIdx);
    const imgUrl = images[activeImgIdx]?.url;
    if (!imgUrl) return;
    const timer = setTimeout(async () => {
      try {
        const url = await renderPreview(imgUrl, params);
        if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
        prevBlobRef.current = url;
        setPreviewUrl(url);
      } catch (e) { console.error(e); }
    }, 80);
    return () => clearTimeout(timer);
  }, [getEffectiveParams, activeImgIdx, images]);

  // ── Initialise filter selection when candidates arrive ──
  useEffect(() => {
    if (!isManual && candidates.length > 0 && selectedFilterIdx === null) {
      setSelectedFilterIdx(0);
    }
  }, [candidates, isManual, selectedFilterIdx]);

  // ── Handlers ──
  function selectFilter(idx) {
    setSelectedFilterIdx(idx);
    setPreviewUrl(null);
  }

  function selectImage(idx) {
    setActiveImgIdx(idx);
    setPreviewUrl(null);
  }

  function setDelta(key, val) {
    setPerImageDelta((prev) => ({
      ...prev,
      [activeImgIdx]: { ...(prev[activeImgIdx] ?? {}), [key]: val },
    }));
  }

  function resetDelta() {
    setPerImageDelta((prev) => ({ ...prev, [activeImgIdx]: {} }));
  }

  // Batch apply: clear all per-image deltas so they all use the shared filter
  function handleBatchApply() {
    setPerImageDelta({});
  }

  // ── Download ──
  async function handleDownload() {
    setApplying(true);
    try {
      if (images.length === 1) {
        // Single image → direct download
        const { result_url } = await applyParams(images[0].imageId, getEffectiveParams(0), sessionId);
        if (result_url) {
          const blob = await fetchBlob(result_url);
          saveBlobAs(blob, "phototune.jpg");
        }
        return;
      }

      // Multiple images → apply each individually (honouring per-image deltas),
      // collect blobs, then zip into one file.
      const entries = [];
      for (let i = 0; i < images.length; i++) {
        const { result_url } = await applyParams(images[i].imageId, getEffectiveParams(i), sessionId);
        if (result_url) {
          const blob = await fetchBlob(result_url);
          entries.push({ blob, filename: `phototune_${i + 1}.jpg` });
        }
      }
      if (entries.length > 0) {
        const zipBlob = await buildZip(entries);
        saveBlobAs(zipBlob, "phototune_edited.zip");
      }
    } finally {
      setApplying(false);
    }
  }

  const groups        = isManual ? MANUAL_GROUPS : FINE_GROUPS;
  const activeImg     = images[activeImgIdx];
  const activeDelta   = perImageDelta[activeImgIdx] ?? {};
  const activeParams  = getEffectiveParams(activeImgIdx);
  const hasPreview    = isManual || selectedFilterIdx !== null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded">
            {images.length} photo{images.length !== 1 ? "s" : ""}
          </span>
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded capitalize">
            {condition.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* ── AI mode: filter cards ── */}
      {!isManual && candidates.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Choose a filter</p>
          <div className="grid grid-cols-3 gap-4">
            {candidates.map((c, i) => (
              <FilterCard
                key={i}
                candidate={c}
                originalUrl={images[0].url}
                selected={selectedFilterIdx === i}
                intensity={selectedFilterIdx === i ? intensity : 100}
                onSelect={() => selectFilter(i)}
                onIntensityChange={(v) => {
                  selectFilter(i);
                  setIntensity(v);
                }}
              />
            ))}
          </div>
          {/* Global intensity slider (only shown for the selected filter) */}
          {selectedFilterIdx !== null && (
            <div className="flex items-center gap-3 px-1">
              <span className="text-xs text-gray-500 w-16 shrink-0">Intensity</span>
              <input
                type="range" min={0} max={100} step={1}
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-xs text-gray-400 w-8 text-right">{intensity}%</span>
            </div>
          )}
        </section>
      )}

      {/* ── Scroll preview strip ── */}
      {images.length > 1 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">All photos</p>
            <p className="text-xs text-gray-600">tap to select &amp; fine-tune individually</p>
          </div>
          <ScrollPreview
            images={images}
            selectedIdx={activeImgIdx}
            getParams={getEffectiveParams}
            onSelect={selectImage}
            perImageDelta={perImageDelta}
          />
        </section>
      )}

      {/* ── Before / After split preview ── */}
      {hasPreview && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
              Before / After — Photo {activeImgIdx + 1}
            </p>
            <p className="text-xs text-gray-600">
              {previewUrl
                ? (isManual ? "Manual edit" : `${candidates[selectedFilterIdx]?.name} · ${intensity}%`)
                : "Rendering…"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-gray-600 text-center">Original</p>
              <div className="aspect-video rounded-xl overflow-hidden bg-gray-900">
                <img src={activeImg.url} alt="original" className="w-full h-full object-contain" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-gray-600 text-center">Edited</p>
              <div className="aspect-video rounded-xl overflow-hidden bg-gray-900">
                <img
                  src={previewUrl ?? activeImg.url}
                  alt="preview"
                  className="w-full h-full object-contain transition-opacity duration-150"
                  style={{
                    opacity: previewUrl ? 1 : 0.3,
                    filter: sharpnessCss(activeParams),
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Per-image fine-tune sliders ── */}
      {hasPreview && (
        <section className="flex flex-col gap-3">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            {isManual ? "Adjustments" : `Fine-tune Photo ${activeImgIdx + 1}`}
          </p>
          <FineTunePanel
            groups={groups}
            delta={activeDelta}
            onChange={setDelta}
            onReset={resetDelta}
            isManual={isManual}
          />
        </section>
      )}

      {/* ── Batch apply banner (only in AI mode with multiple images) ── */}
      {!isManual && images.length > 1 && selectedFilterIdx !== null && (
        <BatchBanner imageCount={images.length} onApply={handleBatchApply} />
      )}

      {/* ── Download ── */}
      {hasPreview && (
        <button
          onClick={handleDownload}
          disabled={applying}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
            text-white font-semibold py-3.5 rounded-xl transition-colors"
        >
          {applying
            ? "Processing…"
            : images.length > 1
              ? `Download all ${images.length} photos`
              : "Download"}
        </button>
      )}

    </div>
  );
}
