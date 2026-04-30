from PIL import Image, ImageEnhance, ImageFilter
import numpy as np


def apply_params(img: Image.Image, params: dict) -> Image.Image:
    """
    Apply Lightroom-style adjustments to an image.

    Light:   exposure [-5, +5], contrast [-100, +100],
             highlights [-100, +100], shadows [-100, +100],
             whites [-100, +100], blacks [-100, +100]
    Color:   temperature [-100, +100], tint [-100, +100],
             vibrance [-100, +100], saturation [-100, +100]
    Detail:  sharpness [0, 150], noise_reduction [0, 100]
    """
    img = img.convert("RGB")

    # ── Light ─────────────────────────────────────────────────────────────────

    exposure = params.get("exposure", 0)
    if exposure != 0:
        img = ImageEnhance.Brightness(img).enhance(2 ** exposure)

    contrast = params.get("contrast", 0)
    if contrast != 0:
        img = ImageEnhance.Contrast(img).enhance(1 + contrast / 100)

    highlights = params.get("highlights", 0)
    shadows    = params.get("shadows",    0)
    whites     = params.get("whites",     0)
    blacks     = params.get("blacks",     0)

    if any(v != 0 for v in (highlights, shadows, whites, blacks)):
        lut = _build_tone_lut(highlights, shadows, whites, blacks)
        arr = np.array(img, dtype=np.uint8)
        img = Image.fromarray(lut[arr])

    # ── Color ─────────────────────────────────────────────────────────────────

    temperature = params.get("temperature", 0)
    tint        = params.get("tint",        0)

    if temperature != 0 or tint != 0:
        arr = np.array(img, dtype=np.float32)
        if temperature != 0:
            scale = temperature / 100.0 * 0.15
            arr[:, :, 0] = np.clip(arr[:, :, 0] * (1 + scale), 0, 255)  # R warm
            arr[:, :, 2] = np.clip(arr[:, :, 2] * (1 - scale), 0, 255)  # B cool
        if tint != 0:
            # positive = magenta (remove green), negative = green
            scale = tint / 100.0 * 0.1
            arr[:, :, 1] = np.clip(arr[:, :, 1] * (1 - scale), 0, 255)  # G
        img = Image.fromarray(arr.astype(np.uint8))

    saturation = params.get("saturation", 0)
    if saturation != 0:
        img = ImageEnhance.Color(img).enhance(1 + saturation / 100)

    vibrance = params.get("vibrance", 0)
    if vibrance != 0:
        img = _apply_vibrance(img, vibrance)

    # ── Detail ────────────────────────────────────────────────────────────────

    noise_reduction = params.get("noise_reduction", 0)
    if noise_reduction > 0:
        radius = noise_reduction / 100.0 * 1.5
        img = img.filter(ImageFilter.GaussianBlur(radius=radius))

    sharpness = params.get("sharpness", 0)
    if sharpness > 0:
        img = img.filter(ImageFilter.UnsharpMask(
            radius=1.5,
            percent=int(sharpness * 1.5),
            threshold=3,
        ))

    return img


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_tone_lut(highlights: float, shadows: float,
                    whites: float, blacks: float) -> np.ndarray:
    """Build a [256] uint8 LUT for tone-range adjustments."""
    x = np.arange(256, dtype=np.float32) / 255.0

    # Blacks: 0–0.25
    if blacks != 0:
        weight = np.clip(1 - x / 0.25, 0, 1)
        x = np.clip(x + blacks / 100.0 * 0.25 * weight, 0, 1)

    # Shadows: 0–0.5, peak ~0.15
    if shadows != 0:
        weight = np.clip(x / 0.15, 0, 1) * np.clip((0.5 - x) / 0.35, 0, 1)
        x = np.clip(x + shadows / 100.0 * 0.20 * weight, 0, 1)

    # Highlights: 0.5–1.0, peak ~0.85
    if highlights != 0:
        weight = np.clip((x - 0.5) / 0.35, 0, 1) * np.clip((1.0 - x) / 0.15, 0, 1)
        x = np.clip(x + highlights / 100.0 * 0.20 * weight, 0, 1)

    # Whites: 0.75–1.0
    if whites != 0:
        weight = np.clip((x - 0.75) / 0.25, 0, 1)
        x = np.clip(x + whites / 100.0 * 0.25 * weight, 0, 1)

    return (x * 255).astype(np.uint8)


def _apply_vibrance(img: Image.Image, vibrance: float) -> Image.Image:
    """Boost saturation selectively: less-saturated pixels get a stronger lift."""
    arr = np.array(img, dtype=np.float32) / 255.0
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    cmax = np.maximum(np.maximum(r, g), b)
    cmin = np.minimum(np.minimum(r, g), b)
    sat  = cmax - cmin                          # 0 = gray, 1 = fully saturated

    boost = (vibrance / 100.0) * (1.0 - sat)   # desaturated pixels → more boost
    gray  = ((r + g + b) / 3.0)[:, :, np.newaxis]
    boost = boost[:, :, np.newaxis]

    arr = np.clip(arr + (arr - gray) * boost, 0, 1)
    return Image.fromarray((arr * 255).astype(np.uint8))
