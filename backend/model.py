"""
PhotoTune recommendation model.

The production path can load trained FiveK weights later, but the project needs
an end-to-end model-based condition today. This module therefore implements a
deterministic image-statistics recommender: it estimates exposure, dynamic range,
color cast, saturation, and detail, then maps those measurements into three
distinct Lightroom-style presets.
"""

import numpy as np
from functools import lru_cache
from pathlib import Path
from PIL import Image

PARAM_KEYS = [
    "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
    "temperature", "tint", "vibrance", "saturation", "sharpness",
    "noise_reduction",
]

PARAM_RANGES = {
    "exposure": (-5.0, 5.0),
    "contrast": (-100, 100),
    "highlights": (-100, 100),
    "shadows": (-100, 100),
    "whites": (-100, 100),
    "blacks": (-100, 100),
    "temperature": (-100, 100),
    "tint": (-100, 100),
    "vibrance": (-100, 100),
    "saturation": (-100, 100),
    "sharpness": (0, 150),
    "noise_reduction": (0, 100),
}


def recommend_params(img: Image.Image, condition: str = "model_based") -> list[dict]:
    if condition == "rule_based":
        return _rule_based(img)
    if condition == "model_based":
        return _model_inference(img)
    return []  # manual condition: no suggestions


def model_status() -> dict[str, object]:
    linear_models = _load_linear_models()
    return {
        "trained_weights_loaded": bool(linear_models),
        "styles": [spec["name"] for spec in linear_models] if linear_models else [],
    }


# ── Rule-based (always works) ─────────────────────────────────────────────────

def _rule_based(img: Image.Image) -> list[dict]:
    arr = np.array(img, dtype=np.float32) / 255.0
    brightness = arr.mean()

    # Auto-correct exposure based on measured brightness
    exp = 0.0
    if brightness < 0.35:
        exp = 0.7
    elif brightness > 0.65:
        exp = -0.3

    return [_candidate(c["name"], c["params"]) for c in [
        {
            "name": "Natural",
            "params": {
                "exposure":    round(exp, 2),
                "contrast":    10,
                "highlights":  -15,
                "shadows":      20,
                "whites":        5,
                "blacks":       -5,
                "temperature":   5,
                "tint":          0,
                "vibrance":     15,
                "saturation":    5,
                "sharpness":    40,
                "noise_reduction": 10,
            },
        },
        {
            "name": "Vivid",
            "params": {
                "exposure":    round(exp + 0.2, 2),
                "contrast":    25,
                "highlights":  -20,
                "shadows":      30,
                "whites":       10,
                "blacks":       -8,
                "temperature":  15,
                "tint":          3,
                "vibrance":     35,
                "saturation":   20,
                "sharpness":    60,
                "noise_reduction": 5,
            },
        },
        {
            "name": "Cinematic",
            "params": {
                "exposure":    round(exp + 0.1, 2),
                "contrast":    -5,
                "highlights":  -35,
                "shadows":      25,
                "whites":       -5,
                "blacks":        5,
                "temperature":  -8,
                "tint":         -2,
                "vibrance":    -10,
                "saturation":  -20,
                "sharpness":    30,
                "noise_reduction": 15,
            },
        },
    ]]


# ── Model inference (replace with real model) ─────────────────────────────────

def _model_inference(img: Image.Image) -> list[dict]:
    stats = _image_stats(img)
    linear_models = _load_linear_models()
    if linear_models:
        features = _feature_vector(stats)
        return [
            _candidate(spec["name"], dict(zip(PARAM_KEYS, _predict_linear(spec, features))))
            for spec in linear_models
        ]

    exposure_fix = np.clip((0.50 - stats["brightness"]) * 2.2, -0.9, 0.9)
    shadow_lift = np.clip((0.28 - stats["p25"]) * 115, -8, 38)
    highlight_pull = -np.clip((stats["p95"] - 0.78) * 135, 0, 42)
    contrast_fix = np.clip((0.22 - stats["contrast"]) * 90, -18, 26)
    vibrance_fix = np.clip((0.34 - stats["saturation"]) * 85, 4, 34)
    temp_fix = np.clip(-stats["warmth"] * 85, -22, 22)
    tint_fix = np.clip(-stats["green_cast"] * 75, -14, 14)
    detail = 26 if stats["sharpness"] > 0.09 else 46
    denoise = 18 if stats["noise"] > 0.055 else 8

    return [
        _candidate("Natural", {
            "exposure": exposure_fix,
            "contrast": contrast_fix,
            "highlights": highlight_pull,
            "shadows": shadow_lift,
            "whites": 6 if stats["p95"] < 0.82 else -3,
            "blacks": -7 if stats["p05"] > 0.06 else 3,
            "temperature": temp_fix,
            "tint": tint_fix,
            "vibrance": vibrance_fix,
            "saturation": 4,
            "sharpness": detail,
            "noise_reduction": denoise,
        }),
        _candidate("Vivid", {
            "exposure": exposure_fix + 0.12,
            "contrast": contrast_fix + 18,
            "highlights": highlight_pull - 6,
            "shadows": shadow_lift + 8,
            "whites": 12,
            "blacks": -14,
            "temperature": temp_fix + 8,
            "tint": tint_fix + 2,
            "vibrance": vibrance_fix + 22,
            "saturation": 13,
            "sharpness": detail + 20,
            "noise_reduction": max(4, denoise - 5),
        }),
        _candidate("Cinematic", {
            "exposure": exposure_fix - 0.04,
            "contrast": contrast_fix - 8,
            "highlights": highlight_pull - 24,
            "shadows": shadow_lift + 12,
            "whites": -8,
            "blacks": 8,
            "temperature": temp_fix - 10,
            "tint": tint_fix - 4,
            "vibrance": vibrance_fix - 20,
            "saturation": -18,
            "sharpness": max(18, detail - 8),
            "noise_reduction": denoise + 10,
        }),
    ]


def _image_stats(img: Image.Image) -> dict[str, float]:
    sample = img.convert("RGB").resize((256, 256))
    arr = np.asarray(sample, dtype=np.float32) / 255.0
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b

    cmax = arr.max(axis=2)
    cmin = arr.min(axis=2)
    saturation = np.where(cmax == 0, 0, (cmax - cmin) / np.maximum(cmax, 1e-6))

    # Neighbor differences are a cheap proxy for both sharp detail and sensor
    # noise. Very small values indicate soft images; strong high-frequency
    # residuals suggest light denoising is helpful.
    dx = np.abs(luminance[:, 1:] - luminance[:, :-1])
    dy = np.abs(luminance[1:, :] - luminance[:-1, :])
    high_freq = float((dx.mean() + dy.mean()) / 2)

    return {
        "brightness": float(luminance.mean()),
        "contrast": float(luminance.std()),
        "p05": float(np.quantile(luminance, 0.05)),
        "p25": float(np.quantile(luminance, 0.25)),
        "p95": float(np.quantile(luminance, 0.95)),
        "saturation": float(saturation.mean()),
        "warmth": float(r.mean() - b.mean()),
        "green_cast": float(g.mean() - ((r.mean() + b.mean()) / 2)),
        "sharpness": high_freq,
        "noise": max(0.0, high_freq - float(luminance.std()) * 0.22),
    }


def _feature_vector(stats: dict[str, float]) -> np.ndarray:
    return np.array([
        1.0,
        stats["brightness"],
        stats["contrast"],
        stats["p05"],
        stats["p25"],
        stats["p95"],
        stats["saturation"],
        stats["warmth"],
        stats["green_cast"],
        stats["sharpness"],
        stats["noise"],
    ], dtype=np.float32)


@lru_cache(maxsize=1)
def _load_linear_models() -> tuple[dict[str, np.ndarray | str], ...]:
    weights_dir = Path(__file__).resolve().parent / "weights"
    specs = [
        ("Natural", "expertC_linear.npz"),
        ("Vivid", "expertA_linear.npz"),
        ("Cinematic", "expertE_linear.npz"),
    ]
    models = []
    for name, filename in specs:
        path = weights_dir / filename
        if not path.exists():
            return ()
        data = np.load(path, allow_pickle=False)
        model = {
            "name": name,
            "weights": data["weights"].astype(np.float32),
            "feature_mean": data["feature_mean"].astype(np.float32) if "feature_mean" in data else np.zeros(11, dtype=np.float32),
            "feature_std": data["feature_std"].astype(np.float32) if "feature_std" in data else np.ones(11, dtype=np.float32),
        }
        models.append(model)
    return tuple(models)


def _predict_linear(spec: dict[str, np.ndarray | str], features: np.ndarray) -> np.ndarray:
    weights = spec["weights"]
    mean = spec["feature_mean"]
    std = spec["feature_std"]
    if not isinstance(weights, np.ndarray) or not isinstance(mean, np.ndarray) or not isinstance(std, np.ndarray):
        raise TypeError("Invalid linear model format")
    std = np.where(std < 1e-6, 1.0, std)
    normalized = (features - mean) / std
    return normalized @ weights


def _candidate(name: str, params: dict) -> dict:
    normalized = {}
    for key in PARAM_KEYS:
        value = params.get(key, 0)
        low, high = PARAM_RANGES[key]
        value = float(np.clip(value, low, high))
        normalized[key] = round(value, 2) if key == "exposure" else int(round(value))
    return {"name": name, "params": normalized}
