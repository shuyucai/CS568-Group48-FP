// JavaScript port of backend/image_processing.py — runs in-browser via Canvas API.
// Mirrors the same math so the preview matches the final Pillow output.

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function buildToneLut(highlights = 0, shadows = 0, whites = 0, blacks = 0) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let x = i / 255;

    if (blacks !== 0) {
      const w = Math.max(0, 1 - x / 0.25);
      x = Math.min(1, Math.max(0, x + (blacks / 100) * 0.25 * w));
    }
    if (shadows !== 0) {
      const w = Math.min(x / 0.15, 1) * Math.max(0, (0.5 - x) / 0.35);
      x = Math.min(1, Math.max(0, x + (shadows / 100) * 0.20 * w));
    }
    if (highlights !== 0) {
      const w = Math.min((x - 0.5) / 0.35, 1) * Math.max(0, (1.0 - x) / 0.15);
      x = Math.min(1, Math.max(0, x + (highlights / 100) * 0.20 * w));
    }
    if (whites !== 0) {
      const w = Math.max(0, (x - 0.75) / 0.25);
      x = Math.min(1, Math.max(0, x + (whites / 100) * 0.25 * w));
    }

    lut[i] = Math.round(x * 255);
  }
  return lut;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

async function toBlob(canvas) {
  if (canvas instanceof OffscreenCanvas)
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
}

/**
 * Render a preview with all 12 params applied.
 * Returns a blob URL (remember to call URL.revokeObjectURL when done).
 */
export async function renderPreview(imageUrl, params, maxSize = 900) {
  const img = await loadImage(imageUrl);

  // Scale down for performance
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth  * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = makeCanvas(w, h);
  const ctx    = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d       = imgData.data;

  const lut = buildToneLut(
    params.highlights ?? 0,
    params.shadows    ?? 0,
    params.whites     ?? 0,
    params.blacks     ?? 0,
  );

  const exposure   = Math.pow(2, params.exposure ?? 0);
  const contrast   = 1 + (params.contrast   ?? 0) / 100;
  const saturation = 1 + (params.saturation  ?? 0) / 100;
  const vibrance   =     (params.vibrance    ?? 0) / 100;
  const tempScale  =     (params.temperature ?? 0) / 100 * 0.15;
  const tintScale  =     (params.tint        ?? 0) / 100 * 0.10;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];

    // 1. Exposure
    r *= exposure; g *= exposure; b *= exposure;

    // 2. Tone curve
    r = lut[clamp(r)]; g = lut[clamp(g)]; b = lut[clamp(b)];

    // 3. Temperature (R↑ B↓ = warm; R↓ B↑ = cool)
    r *= (1 + tempScale);
    b *= (1 - tempScale);

    // 4. Tint (positive = magenta → suppress green)
    g *= (1 - tintScale);

    // 5. Contrast around midpoint 128
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;

    // 6. Saturation
    if (saturation !== 1) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;
    }

    // 7. Vibrance (desaturated pixels boosted more)
    if (vibrance !== 0) {
      const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      const boost = vibrance * (1 - sat);
      const gray  = (r + g + b) / 3;
      r = gray + (r - gray) * (1 + boost);
      g = gray + (g - gray) * (1 + boost);
      b = gray + (b - gray) * (1 + boost);
    }

    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }

  ctx.putImageData(imgData, 0, 0);

  // Sharpness / Noise reduction: apply as CSS filter on the <img> element
  // (convolution in JS is expensive; handled separately in the component)

  return URL.createObjectURL(await toBlob(canvas));
}
