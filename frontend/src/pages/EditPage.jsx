import { useState, useEffect, useRef, useMemo } from "react";
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
  { key: "brighter", label: "Brighter" },
  { key: "darker", label: "Darker" },
  { key: "warmer", label: "Warmer" },
  { key: "cooler", label: "Cooler" },
  { key: "more_contrast", label: "More contrast" },
  { key: "less_contrast", label: "Less contrast" },
  { key: "more_saturated", label: "More color" },
  { key: "less_saturated", label: "Less color" },
];

function sharpnessCss(params) {
  const nr = (params.noise_reduction ?? 0) / 100 * 1.5;
  return nr > 0 ? `blur(${nr.toFixed(2)}px)` : "none";
}

// Fetch result from backend and trigger browser save dialog
async function triggerDownload(resultUrl, filename) {
  const resp = await fetch(resultUrl);
  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

export default function EditPage({ images, sessionId, condition, candidates, onBack }) {
  const isManual = condition === "manual";

  const [selectedIdx,  setSelectedIdx]  = useState(isManual ? null : 0);
  const [intensities,  setIntensities]  = useState([100, 100, 100]);
  const [fineDeltas,   setFineDeltas]   = useState({});
  const [showFine,     setShowFine]     = useState(isManual);
  const [applying,     setApplying]     = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [previewUrl,   setPreviewUrl]   = useState(null);
  const prevBlobRef = useRef(null);

  const primaryImage = images[0];
  const isBatch      = images.length > 1;

  const effectiveParams = useMemo(() => {
    const base  = (!isManual && selectedIdx !== null) ? (candidates[selectedIdx]?.params ?? {}) : {};
    const scale = (!isManual && selectedIdx !== null) ? intensities[selectedIdx] / 100 : 1;
    const result = {};
    for (const [k, v] of Object.entries(base)) result[k] = (v ?? 0) * scale;
    for (const [k, v] of Object.entries(fineDeltas)) result[k] = (result[k] ?? 0) + v;
    return result;
  }, [isManual, selectedIdx, candidates, intensities, fineDeltas]);

  const hasPreview = isManual || selectedIdx !== null;

  // Canvas preview debounced 80ms
  useEffect(() => {
    if (!hasPreview) return;
    const timer = setTimeout(async () => {
      try {
        const url = await renderPreview(primaryImage.url, effectiveParams);
        if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
        prevBlobRef.current = url;
        setPreviewUrl(url);
      } catch (e) { console.error(e); }
    }, 80);
    return () => clearTimeout(timer);
  }, [effectiveParams, primaryImage.url, hasPreview]);

  useEffect(() => {
    if (!isManual && candidates.length > 0 && selectedIdx === null) setSelectedIdx(0);
  }, [candidates]);

  useEffect(() => {
    setSelectedIdx(isManual ? null : 0);
    setFineDeltas({});
    setShowFine(isManual);
    setPreviewUrl(null);
  }, [condition, isManual]);

  function selectCard(idx) {
    setSelectedIdx(idx);
    setFineDeltas({});
    setPreviewUrl(null);
  }

  function setIntensity(idx, val) {
    setIntensities((prev) => prev.map((v, i) => (i === idx ? val : v)));
  }

  function setDelta(key, val) {
    setFineDeltas((d) => ({ ...d, [key]: val }));
  }

  async function handleFeedback(direction) {
    if (!primaryImage || feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      const { params } = await sendFeedback(
        primaryImage.imageId,
        effectiveParams,
        direction,
        sessionId
      );
      if (params) {
        setSelectedIdx(null);
        setFineDeltas(params);
        setShowFine(true);
      }
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function handleDownload() {
    setApplying(true);
    try {
      if (isBatch) {
        const { results } = await batchApply(
          images.map((i) => i.imageId), effectiveParams, sessionId
        );
        for (let i = 0; i < results.length; i++) {
          if (results[i].result_url) {
            await triggerDownload(results[i].result_url, `phototune_${i + 1}.jpg`);
          }
        }
      } else {
        const { result_url } = await applyParams(
          primaryImage.imageId, effectiveParams, sessionId
        );
        if (result_url) await triggerDownload(result_url, "phototune.jpg");
      }
    } finally {
      setApplying(false);
    }
  }

  const groups = isManual ? MANUAL_GROUPS : FINE_GROUPS;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">

      {/* Top bar */}
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

      {/* ── AI mode: filter cards first ── */}
      {!isManual && candidates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {candidates.map((c, i) => (
            <FilterCard
              key={i}
              candidate={c}
              originalUrl={primaryImage.url}
              selected={selectedIdx === i}
              intensity={intensities[i]}
              onSelect={() => selectCard(i)}
              onIntensityChange={(v) => setIntensity(i, v)}
            />
          ))}
        </div>
      )}

      {/* ── Main preview ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {previewUrl ? "Preview" : hasPreview ? "Rendering..." : "Select a filter above"}
          </p>
          {/* Original label */}
          <p className="text-xs text-gray-600">
            {isManual ? "Editing from original" : selectedIdx !== null ? `${candidates[selectedIdx]?.name} / ${intensities[selectedIdx]}%` : "Custom feedback edit"}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Original */}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-gray-600 text-center">Original</p>
            <div className="aspect-video rounded-lg overflow-hidden bg-gray-900">
              <img src={primaryImage.url} alt="original" className="w-full h-full object-contain" />
            </div>
          </div>
          {/* Preview */}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-gray-600 text-center">Edited</p>
            <div className="aspect-video rounded-lg overflow-hidden bg-gray-900">
              <img
                src={previewUrl ?? primaryImage.url}
                alt="preview"
                className="w-full h-full object-contain"
                style={{
                  opacity: previewUrl ? 1 : 0.3,
                  filter: sharpnessCss(effectiveParams),
                  transition: "opacity 0.15s",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Fine-tune / Manual sliders ── */}
      {hasPreview && (
        <div className="bg-gray-900 rounded-lg p-5 flex flex-col gap-5">
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
                      <span className="text-xs text-gray-400">{label}</span>
                      <div className="relative">
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={fineDeltas[key] ?? 0}
                          onChange={(e) => setDelta(key, parseFloat(e.target.value))}
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

      {/* ── Download — always at the very bottom ── */}
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
              ? `Download all ${images.length} photos`
              : "Download"}
        </button>
      )}

    </div>
  );
}
