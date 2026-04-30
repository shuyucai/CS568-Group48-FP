import { useRef, useState } from "react";
import { uploadBatch, getRecommendations } from "../api";

const CONDITIONS = [
  { value: "model_based", label: "AI Recommendation" },
  { value: "manual",      label: "Manual" },
];

export default function UploadPage({ sessionId, onDone, setCandidates }) {
  const [files, setFiles] = useState([]);
  const [condition, setCondition] = useState("model_based");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  function addFiles(newFiles) {
    const imageFiles = Array.from(newFiles).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...imageFiles].slice(0, 10));
  }

  async function handleStart() {
    if (files.length === 0) return;
    setLoading(true);
    try {
      const { images } = await uploadBatch(files);
      // Fetch recommendations using first image
      const { candidates } = await getRecommendations(images[0].imageId, sessionId, condition);
      setCandidates(candidates ?? []);
      onDone(images, condition);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16 flex flex-col gap-8">
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors
          ${dragging ? "border-blue-400 bg-blue-950/30" : "border-gray-700 hover:border-gray-500"}`}
        onClick={() => inputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <p className="text-gray-400 text-sm">Drop photos here or <span className="text-blue-400 underline">browse</span></p>
        <p className="text-gray-600 text-xs mt-1">JPEG / PNG · up to 10 photos</p>
      </div>

      {/* Thumbnails */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {files.map((f, i) => (
            <div key={i} className="relative group">
              <img
                src={URL.createObjectURL(f)}
                className="w-20 h-20 object-cover rounded-lg"
                alt=""
              />
              <button
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 bg-red-500 rounded-full w-4 h-4 text-xs hidden group-hover:flex items-center justify-center"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Condition selector (for user study) */}
      <div className="flex flex-col gap-2">
        <label className="text-sm text-gray-400">Editing condition</label>
        <div className="flex gap-2">
          {CONDITIONS.map((c) => (
            <button
              key={c.value}
              onClick={() => setCondition(c.value)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors
                ${condition === c.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleStart}
        disabled={files.length === 0 || loading}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
          text-white font-medium py-3 rounded-xl transition-colors"
      >
        {loading ? "Uploading…" : `Start Editing${files.length > 1 ? ` (${files.length} photos)` : ""}`}
      </button>
    </div>
  );
}
