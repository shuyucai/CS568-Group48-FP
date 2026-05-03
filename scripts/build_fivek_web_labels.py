"""Build PhotoTune training labels directly from FiveK web assets.

This script avoids downloading the 50GB archive. It:
1) crawls the official FiveK index page for image IDs,
2) downloads input DNG + expert TIFFs (A/C/E) for a subset,
3) infers Lightroom-like pseudo slider labels from input/output statistics,
4) writes a CSV that can be consumed by scripts/train_linear_baseline.py.

This is intended for low-storage environments and course prototyping.
"""

from __future__ import annotations

import argparse
import csv
import math
import random
import re
import subprocess
import time
from urllib.parse import quote
from pathlib import Path

import numpy as np
from PIL import Image

INDEX_URL = "https://data.csail.mit.edu/graphics/fivek/"
BASE_URL = "https://data.csail.mit.edu/graphics/fivek/img"

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

EXPERTS = {
    "A": "Vivid",
    "C": "Natural",
    "E": "Cinematic",
}


def fetch(url: str, out_path: Path, timeout: int = 60, retries: int = 3) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            subprocess.run(
                [
                    "curl",
                    "-L",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--max-time",
                    str(timeout),
                    "-A",
                    "PhotoTune-Training/1.0",
                    url,
                    "-o",
                    str(tmp_path),
                ],
                check=True,
            )
            tmp_path.replace(out_path)
            return
        except Exception as e:
            last_err = e
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(1.0 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def load_rgb(path: Path, url: str, timeout: int = 60) -> Image.Image:
    # Validate file contents; if corrupted, re-download once.
    for _ in range(2):
        if not path.exists():
            fetch(url, path, timeout=timeout)
        try:
            img = Image.open(path).convert("RGB")
            img.load()
            return img
        except Exception:
            path.unlink(missing_ok=True)
    raise RuntimeError(f"Failed to open image from {path}")


def url_name(name: str) -> str:
    # Keep filename characters but encode unsafe URL bytes.
    return quote(name, safe="-_.()")


def parse_names(index_html: str) -> list[str]:
    names = re.findall(r'img/dng/([^"]+)\.dng', index_html)
    # Preserve order while de-duplicating.
    seen = set()
    out = []
    for name in names:
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def image_stats(img: Image.Image) -> dict[str, float]:
    sample = img.convert("RGB").resize((256, 256))
    arr = np.asarray(sample, dtype=np.float32) / 255.0
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    cmax = arr.max(axis=2)
    cmin = arr.min(axis=2)
    sat = np.where(cmax == 0, 0, (cmax - cmin) / np.maximum(cmax, 1e-6))
    dx = np.abs(lum[:, 1:] - lum[:, :-1])
    dy = np.abs(lum[1:, :] - lum[:-1, :])
    high_freq = float((dx.mean() + dy.mean()) / 2)
    return {
        "brightness": float(lum.mean()),
        "contrast": float(lum.std()),
        "p05": float(np.quantile(lum, 0.05)),
        "p25": float(np.quantile(lum, 0.25)),
        "p95": float(np.quantile(lum, 0.95)),
        "saturation": float(sat.mean()),
        "warmth": float(r.mean() - b.mean()),
        "green_cast": float(g.mean() - ((r.mean() + b.mean()) / 2)),
        "sharpness": high_freq,
        "noise": max(0.0, high_freq - float(lum.std()) * 0.22),
    }


def clamp(v: float, low: float, high: float) -> float:
    return float(max(low, min(high, v)))


def infer_params(input_img: Image.Image, output_img: Image.Image) -> dict[str, float]:
    i = image_stats(input_img)
    o = image_stats(output_img)
    eps = 1e-6

    exposure = clamp(math.log2((o["brightness"] + eps) / (i["brightness"] + eps)), -5.0, 5.0)
    contrast = clamp((o["contrast"] / (i["contrast"] + eps) - 1.0) * 100, -100, 100)
    highlights = clamp((o["p95"] - i["p95"]) * 260, -100, 100)
    shadows = clamp((o["p25"] - i["p25"]) * 260, -100, 100)
    whites = clamp((o["p95"] - i["p95"]) * 320, -100, 100)
    blacks = clamp((o["p05"] - i["p05"]) * 320, -100, 100)
    temperature = clamp((o["warmth"] - i["warmth"]) * 260, -100, 100)
    tint = clamp((o["green_cast"] - i["green_cast"]) * 360, -100, 100)
    saturation = clamp((o["saturation"] - i["saturation"]) * 220, -100, 100)
    vibrance = clamp(saturation * 1.2 + (0.35 - i["saturation"]) * 20, -100, 100)
    sharpness = clamp(40 + (o["sharpness"] - i["sharpness"]) * 800, 0, 150)
    noise_reduction = clamp(10 + (i["noise"] - o["noise"]) * 1500, 0, 100)

    return {
        "exposure": exposure,
        "contrast": contrast,
        "highlights": highlights,
        "shadows": shadows,
        "whites": whites,
        "blacks": blacks,
        "temperature": temperature,
        "tint": tint,
        "vibrance": vibrance,
        "saturation": saturation,
        "sharpness": sharpness,
        "noise_reduction": noise_reduction,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", type=Path, default=Path("data/fivek_web"))
    parser.add_argument("--out", type=Path, default=Path("data/processed/fivek_web_labels.csv"))
    parser.add_argument("--max-images", type=int, default=300)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from existing output CSV if present.",
    )
    parser.add_argument(
        "--delete-expert-after-use",
        action="store_true",
        help="Delete downloaded expert TIFFs after extracting pseudo labels.",
    )
    args = parser.parse_args()

    args.work_dir.mkdir(parents=True, exist_ok=True)
    index_path = args.work_dir / "index.html"
    fetch(INDEX_URL, index_path)
    html = index_path.read_text(errors="ignore")
    names = parse_names(html)
    if not names:
        raise RuntimeError("No DNG links found on FiveK index page.")

    rng = random.Random(args.seed)
    rng.shuffle(names)
    names = names[: min(args.max_images, len(names))]

    input_dir = args.work_dir / "inputs"
    expert_dir = args.work_dir / "experts"
    rows = []
    existing: dict[tuple[str, str], dict[str, str]] = {}
    if args.resume and args.out.exists():
        with args.out.open() as fh:
            for row in csv.DictReader(fh):
                stem = Path(row["image_path"]).stem
                key = (stem, row["expert"])
                existing[key] = row
        rows.extend(existing.values())
        print(f"Loaded {len(existing)} existing rows from {args.out}")

    skipped = 0

    for idx, name in enumerate(names, start=1):
        input_path = input_dir / f"{name}.dng"
        needed_experts = []
        for expert in EXPERTS:
            if (name, expert) not in existing:
                needed_experts.append(expert)
        if not needed_experts:
            print(f"Processed {idx}/{len(names)} images, rows={len(rows)}, skipped={skipped}")
            continue

        try:
            input_img = load_rgb(input_path, f"{BASE_URL}/dng/{url_name(name)}.dng", timeout=120)
        except Exception:
            skipped += len(needed_experts)
            print(f"Processed {idx}/{len(names)} images, rows={len(rows)}, skipped={skipped}")
            continue

        for expert, style in EXPERTS.items():
            if (name, expert) in existing:
                continue
            out_path = expert_dir / expert / f"{name}.tif"
            try:
                output_img = load_rgb(
                    out_path,
                    f"{BASE_URL}/tiff16_{expert.lower()}/{url_name(name)}.tif",
                    timeout=180,
                )
                params = infer_params(input_img, output_img)
            except Exception:
                skipped += 1
                continue

            rows.append(
                {
                    "image_path": str(input_path),
                    "expert": expert,
                    "style": style,
                    **{k: params[k] for k in PARAM_KEYS},
                }
            )
            if args.delete_expert_after_use:
                out_path.unlink(missing_ok=True)

        print(f"Processed {idx}/{len(names)} images, rows={len(rows)}, skipped={skipped}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["image_path", "expert", "style", *PARAM_KEYS])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {args.out} (skipped={skipped})")


if __name__ == "__main__":
    main()
