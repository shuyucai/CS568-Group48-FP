"""
Model inference stub.
Replace _model_inference() with your trained model when ready.
Rule-based branch works out of the box for early testing.
"""

import numpy as np
from PIL import Image


def recommend_params(img: Image.Image, condition: str = "model_based") -> list[dict]:
    if condition == "rule_based":
        return _rule_based(img)
    if condition == "model_based":
        return _model_inference(img)
    return []  # manual condition: no suggestions


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

    return [
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
    ]


# ── Model inference (replace with real model) ─────────────────────────────────

def _model_inference(img: Image.Image) -> list[dict]:
    # TODO: load your trained model and run inference here.
    # Expected output: same format as _rule_based() — a list of 3 dicts.
    # For now, fall back to rule-based so the UI works end-to-end.
    return _rule_based(img)
