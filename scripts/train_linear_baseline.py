"""Train lightweight PhotoTune linear baselines from prepared FiveK labels.

This avoids heavyweight ML dependencies and produces files that backend/model.py
can load directly:

    backend/weights/expertC_linear.npz
    backend/weights/expertA_linear.npz
    backend/weights/expertE_linear.npz
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
from PIL import Image

PARAM_KEYS = [
    "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
    "temperature", "tint", "vibrance", "saturation", "sharpness",
    "noise_reduction",
]

EXPERT_TO_FILE = {
    "C": "expertC_linear.npz",
    "A": "expertA_linear.npz",
    "E": "expertE_linear.npz",
}


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

    return np.array([
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
    ], dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels", type=Path, default=Path("data/processed/fivek_labels.csv"))
    parser.add_argument("--out-dir", type=Path, default=Path("backend/weights"))
    parser.add_argument("--ridge", type=float, default=0.15)
    args = parser.parse_args()

    rows_by_expert: dict[str, list[dict[str, str]]] = {expert: [] for expert in EXPERT_TO_FILE}
    with args.labels.open() as fh:
        for row in csv.DictReader(fh):
            if row["expert"] in rows_by_expert:
                rows_by_expert[row["expert"]].append(row)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for expert, rows in rows_by_expert.items():
        if not rows:
            print(f"Skipping expert {expert}: no rows")
            continue

        x = np.stack([image_stats(Path(row["image_path"])) for row in rows])
        y = np.array([[float(row[key]) for key in PARAM_KEYS] for row in rows], dtype=np.float32)

        penalty = args.ridge * np.eye(x.shape[1], dtype=np.float32)
        penalty[0, 0] = 0.0
        weights = np.linalg.solve(x.T @ x + penalty, x.T @ y)

        out_path = args.out_dir / EXPERT_TO_FILE[expert]
        np.savez(out_path, weights=weights, param_keys=np.array(PARAM_KEYS))
        print(f"Saved {out_path} from {len(rows)} rows")


if __name__ == "__main__":
    main()
