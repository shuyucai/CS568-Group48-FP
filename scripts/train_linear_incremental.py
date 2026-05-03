"""Incremental PhotoTune training for low-disk environments.

Train ridge linear models part-by-part without keeping the full FiveK dataset.

Workflow:
1) Download/extract one part under --part-dir.
2) Run this script to accumulate training statistics.
3) Delete that part, repeat for the next part.
4) Finalize to export model weights.

Example:
  # Accumulate from one extracted part
  python scripts/train_linear_incremental.py \
    --part-dir data/fivek_part_01 \
    --state backend/weights/incremental_state.npz \
    --mode accumulate

  # After all parts processed, export final weights
  python scripts/train_linear_incremental.py \
    --state backend/weights/incremental_state.npz \
    --out-dir backend/weights \
    --mode finalize
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

PARAM_KEYS = [
    "exposure",
    "contrast",
    "highlights",
    "shadows",
    "whites",
    "blacks",
    "temperature",
    "tint",
    "vibrance",
    "saturation",
    "sharpness",
    "noise_reduction",
]

EXPERTS = ("A", "C", "E")
EXPERT_TO_FILE = {
    "C": "expertC_linear.npz",  # Natural
    "A": "expertA_linear.npz",  # Vivid
    "E": "expertE_linear.npz",  # Cinematic
}

CRS = "http://ns.adobe.com/camera-raw-settings/1.0/"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"


def image_stats(image_path: Path) -> np.ndarray:
    img = Image.open(image_path).convert("RGB").resize((256, 256))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    cmax = arr.max(axis=2)
    cmin = arr.min(axis=2)
    sat = np.where(cmax == 0, 0, (cmax - cmin) / np.maximum(cmax, 1e-6))
    dx = np.abs(lum[:, 1:] - lum[:, :-1])
    dy = np.abs(lum[1:, :] - lum[:-1, :])
    high_freq = float((dx.mean() + dy.mean()) / 2)
    noise = max(0.0, high_freq - float(lum.std()) * 0.22)
    return np.array(
        [
            1.0,
            float(lum.mean()),
            float(lum.std()),
            float(np.quantile(lum, 0.05)),
            float(np.quantile(lum, 0.25)),
            float(np.quantile(lum, 0.95)),
            float(sat.mean()),
            float(r.mean() - b.mean()),
            float(g.mean() - ((r.mean() + b.mean()) / 2)),
            high_freq,
            noise,
        ],
        dtype=np.float32,
    )


def parse_xmp(xmp_path: Path) -> np.ndarray:
    import xml.etree.ElementTree as ET

    root = ET.parse(xmp_path).getroot()
    desc = root.find(f".//{{{RDF}}}Description")
    if desc is None:
        raise ValueError("Missing RDF Description")

    def get_any(keys: tuple[str, ...], default: float = 0.0) -> float:
        for key in keys:
            value = desc.get(f"{{{CRS}}}{key}")
            if value is not None:
                return float(value)
        return float(default)

    temp_k = get_any(("Temperature",), 5500)
    labels = {
        "exposure": get_any(("Exposure2012", "Exposure")),
        "contrast": get_any(("Contrast2012", "Contrast")),
        "highlights": get_any(("Highlights2012", "Highlights")),
        "shadows": get_any(("Shadows2012", "Shadows")),
        "whites": get_any(("Whites2012", "Whites")),
        "blacks": get_any(("Blacks2012", "Blacks")),
        "temperature": (temp_k - 5500) / 2500 * 100,
        "tint": get_any(("Tint",)) / 1.5,
        "vibrance": get_any(("Vibrance",)),
        "saturation": get_any(("Saturation",)),
        "sharpness": get_any(("Sharpness",), 40),
        "noise_reduction": get_any(("LuminanceSmoothing",)),
    }
    return np.array([labels[k] for k in PARAM_KEYS], dtype=np.float32)


def infer_expert(path: Path) -> str | None:
    text = str(path).lower().replace("-", "_")
    for expert in EXPERTS:
        if f"expert{expert.lower()}" in text or f"expert_{expert.lower()}" in text:
            return expert
    return None


def build_image_index(images_dir: Path) -> dict[str, Path]:
    allowed_ext = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dng"}
    index: dict[str, Path] = {}
    for path in images_dir.rglob("*"):
        if path.is_file() and path.suffix.lower() in allowed_ext:
            index.setdefault(path.stem.lower(), path)
    return index


def load_state(state_path: Path) -> dict:
    if not state_path.exists():
        state = {"version": 1}
        for expert in EXPERTS:
            state[f"{expert}_count"] = 0
            state[f"{expert}_xtx"] = np.zeros((11, 11), dtype=np.float64)
            state[f"{expert}_xty"] = np.zeros((11, 12), dtype=np.float64)
        return state

    data = np.load(state_path, allow_pickle=False)
    state = {"version": int(data["version"])}
    for expert in EXPERTS:
        state[f"{expert}_count"] = int(data[f"{expert}_count"])
        state[f"{expert}_xtx"] = data[f"{expert}_xtx"].astype(np.float64)
        state[f"{expert}_xty"] = data[f"{expert}_xty"].astype(np.float64)
    return state


def save_state(state_path: Path, state: dict) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        state_path,
        version=np.array(state["version"]),
        **{
            f"{expert}_{field}": state[f"{expert}_{field}"]
            for expert in EXPERTS
            for field in ("count", "xtx", "xty")
        },
    )


def accumulate(part_dir: Path, state_path: Path) -> None:
    images_dir = part_dir / "images"
    xmp_dir = part_dir / "xmp"
    if not images_dir.exists() or not xmp_dir.exists():
        raise ValueError(f"{part_dir} must contain images/ and xmp/ subdirs")

    image_index = build_image_index(images_dir)
    if not image_index:
        raise ValueError(f"No images found under {images_dir}")

    state = load_state(state_path)
    seen = 0
    skipped = 0
    for xmp_path in sorted(xmp_dir.rglob("*.xmp")):
        expert = infer_expert(xmp_path)
        if expert not in EXPERTS:
            skipped += 1
            continue
        image_path = image_index.get(xmp_path.stem.lower())
        if image_path is None:
            skipped += 1
            continue
        try:
            x = image_stats(image_path).astype(np.float64)
            y = parse_xmp(xmp_path).astype(np.float64)
        except Exception:
            skipped += 1
            continue

        state[f"{expert}_xtx"] += np.outer(x, x)
        state[f"{expert}_xty"] += np.outer(x, y)
        state[f"{expert}_count"] += 1
        seen += 1

    save_state(state_path, state)
    print(
        json.dumps(
            {
                "processed_rows": seen,
                "skipped_rows": skipped,
                "state_path": str(state_path),
                "counts": {expert: state[f"{expert}_count"] for expert in EXPERTS},
            },
            indent=2,
        )
    )


def finalize(state_path: Path, out_dir: Path, ridge: float, metrics_out: Path) -> None:
    state = load_state(state_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    metrics = {"ridge": ridge, "experts": {}}

    for expert in EXPERTS:
        n = state[f"{expert}_count"]
        if n == 0:
            print(f"Skipping expert {expert}: no rows")
            continue

        xtx = state[f"{expert}_xtx"]
        xty = state[f"{expert}_xty"]
        penalty = ridge * np.eye(xtx.shape[0], dtype=np.float64)
        penalty[0, 0] = 0.0
        weights = np.linalg.solve(xtx + penalty, xty).astype(np.float32)

        out_path = out_dir / EXPERT_TO_FILE[expert]
        np.savez(
            out_path,
            weights=weights,
            feature_mean=np.zeros(11, dtype=np.float32),
            feature_std=np.ones(11, dtype=np.float32),
            param_keys=np.array(PARAM_KEYS),
        )
        metrics["experts"][expert] = {"num_rows": int(n), "weight_file": str(out_path)}
        print(f"Saved {out_path} from {n} rows")

    metrics_out.parent.mkdir(parents=True, exist_ok=True)
    with metrics_out.open("w") as fh:
        json.dump(metrics, fh, indent=2)
    print(f"Wrote {metrics_out}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("accumulate", "finalize"), required=True)
    parser.add_argument("--part-dir", type=Path, default=None)
    parser.add_argument("--state", type=Path, default=Path("backend/weights/incremental_state.npz"))
    parser.add_argument("--out-dir", type=Path, default=Path("backend/weights"))
    parser.add_argument("--ridge", type=float, default=0.15)
    parser.add_argument("--metrics-out", type=Path, default=Path("backend/weights/training_metrics_incremental.json"))
    args = parser.parse_args()

    if args.mode == "accumulate":
        if args.part_dir is None:
            raise ValueError("--part-dir is required for accumulate mode")
        accumulate(args.part_dir, args.state)
    else:
        finalize(args.state, args.out_dir, args.ridge, args.metrics_out)


if __name__ == "__main__":
    main()
