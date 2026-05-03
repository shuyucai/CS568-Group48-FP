// CSS approximation for thumbnail previews (fast, no Canvas needed for small cards)
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

export default function FilterCard({ candidate, originalUrl, selected, intensity, onSelect, onIntensityChange }) {
  const { name, params } = candidate;

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all
        ${selected ? "border-blue-500 shadow-lg shadow-blue-500/20" : "border-gray-700 hover:border-gray-500"}`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] overflow-hidden bg-gray-900">
        <img
          src={originalUrl}
          alt={name}
          className="w-full h-full object-cover"
          style={{ filter: cssFilter(params, intensity) }}
        />
        {selected && (
          <div className="absolute top-2 right-2 bg-blue-500 rounded-full px-2 py-0.5 text-xs font-medium">
            Selected
          </div>
        )}
      </div>

      {/* Name + Intensity slider */}
      <div className="p-3 bg-gray-900 flex flex-col gap-2">
        <p className="text-sm font-medium">{name}</p>

        <div
          className="flex flex-col gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={intensity}
            onChange={(e) => onIntensityChange(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>0%</span>
            <span className="text-gray-300">{intensity}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
