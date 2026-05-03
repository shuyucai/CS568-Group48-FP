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
import json
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


def feature_matrix(rows: list[dict[str, str]]) -> np.ndarray:
    cache: dict[str, np.ndarray] = {}
    vectors: list[np.ndarray] = []
    for row in rows:
        image_path = row["image_path"]
        vector = cache.get(image_path)
        if vector is None:
            vector = image_stats(Path(image_path))
            cache[image_path] = vector
        vectors.append(vector)
    return np.stack(vectors)


def target_matrix(rows: list[dict[str, str]]) -> np.ndarray:
    return np.array([[float(row[key]) for key in PARAM_KEYS] for row in rows], dtype=np.float32)


def train_val_split(
    rows: list[dict[str, str]],
    val_ratio: float,
    seed: int,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    if len(rows) < 10 or val_ratio <= 0:
        return rows, []

    rng = np.random.default_rng(seed)
    indices = np.arange(len(rows))
    rng.shuffle(indices)
    val_size = max(1, int(round(len(rows) * val_ratio)))
    val_indices = set(indices[:val_size].tolist())

    train_rows = [row for i, row in enumerate(rows) if i not in val_indices]
    val_rows = [row for i, row in enumerate(rows) if i in val_indices]
    return train_rows, val_rows


def fit_ridge(x: np.ndarray, y: np.ndarray, ridge: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x_mean = x.mean(axis=0)
    x_std = x.std(axis=0)
    x_std = np.where(x_std < 1e-6, 1.0, x_std)
    x_mean[0] = 0.0
    x_std[0] = 1.0

    x_norm = (x - x_mean) / x_std

    penalty = ridge * np.eye(x_norm.shape[1], dtype=np.float32)
    penalty[0, 0] = 0.0
    weights = np.linalg.solve(x_norm.T @ x_norm + penalty, x_norm.T @ y)
    return weights.astype(np.float32), x_mean.astype(np.float32), x_std.astype(np.float32)


def evaluate(x: np.ndarray, y: np.ndarray, weights: np.ndarray, x_mean: np.ndarray, x_std: np.ndarray) -> dict:
    x_norm = (x - x_mean) / x_std
    pred = x_norm @ weights
    mae_by_param = np.mean(np.abs(pred - y), axis=0)
    baseline = np.mean(np.abs(y - y.mean(axis=0, keepdims=True)), axis=0)
    improvement = np.zeros_like(mae_by_param)
    np.divide(
        (baseline - mae_by_param) * 100.0,
        baseline,
        out=improvement,
        where=baseline > 1e-6,
    )
    return {
        "mae_mean": float(mae_by_param.mean()),
        "mae_by_param": {k: float(v) for k, v in zip(PARAM_KEYS, mae_by_param)},
        "baseline_mae_mean": float(baseline.mean()),
        "improvement_pct_mean": float(improvement.mean()),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels", type=Path, default=Path("data/processed/fivek_labels.csv"))
    parser.add_argument("--out-dir", type=Path, default=Path("backend/weights"))
    parser.add_argument("--ridge", type=float, default=0.15)
    parser.add_argument("--val-ratio", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--metrics-out", type=Path, default=Path("backend/weights/training_metrics.json"))
    args = parser.parse_args()

    rows_by_expert: dict[str, list[dict[str, str]]] = {expert: [] for expert in EXPERT_TO_FILE}
    with args.labels.open() as fh:
        for row in csv.DictReader(fh):
            if row["expert"] in rows_by_expert:
                rows_by_expert[row["expert"]].append(row)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    metrics: dict[str, dict] = {}
    for expert, rows in rows_by_expert.items():
        if not rows:
            print(f"Skipping expert {expert}: no rows")
            continue

        train_rows, val_rows = train_val_split(rows, val_ratio=args.val_ratio, seed=args.seed)
        x_train = feature_matrix(train_rows)
        y_train = target_matrix(train_rows)

        weights, x_mean, x_std = fit_ridge(x_train, y_train, args.ridge)

        out_path = args.out_dir / EXPERT_TO_FILE[expert]
        np.savez(
            out_path,
            weights=weights,
            feature_mean=x_mean,
            feature_std=x_std,
            param_keys=np.array(PARAM_KEYS),
        )

        train_metrics = evaluate(x_train, y_train, weights, x_mean, x_std)
        expert_metrics = {
            "num_rows": len(rows),
            "num_train": len(train_rows),
            "num_val": len(val_rows),
            "train": train_metrics,
        }
        if val_rows:
            x_val = feature_matrix(val_rows)
            y_val = target_matrix(val_rows)
            expert_metrics["val"] = evaluate(x_val, y_val, weights, x_mean, x_std)

        metrics[expert] = expert_metrics
        print(
            f"Saved {out_path} from {len(rows)} rows "
            f"(train_mae={train_metrics['mae_mean']:.3f}"
            + (
                f", val_mae={expert_metrics['val']['mae_mean']:.3f})"
                if "val" in expert_metrics
                else ")"
            )
        )

    args.metrics_out.parent.mkdir(parents=True, exist_ok=True)
    with args.metrics_out.open("w") as fh:
        json.dump(
            {
                "labels_path": str(args.labels),
                "ridge": args.ridge,
                "val_ratio": args.val_ratio,
                "seed": args.seed,
                "experts": metrics,
            },
            fh,
            indent=2,
        )
    print(f"Wrote metrics to {args.metrics_out}")


if __name__ == "__main__":
    main()
