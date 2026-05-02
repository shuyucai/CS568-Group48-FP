"""Parse MIT-Adobe FiveK Lightroom XMP labels for PhotoTune.

Example:
    python scripts/prepare_fivek.py \
        --images-dir data/fivek/images \
        --xmp-dir data/fivek/xmp \
        --out data/processed/fivek_labels.csv
"""

from __future__ import annotations

import argparse
import csv
import xml.etree.ElementTree as ET
from pathlib import Path

CRS = "http://ns.adobe.com/camera-raw-settings/1.0/"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"

PARAM_KEYS = [
    "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
    "temperature", "tint", "vibrance", "saturation", "sharpness",
    "noise_reduction",
]

EXPERTS = {
    "A": "Vivid",
    "C": "Natural",
    "E": "Cinematic",
}


def parse_xmp(xmp_path: Path) -> dict[str, float]:
    root = ET.parse(xmp_path).getroot()
    desc = root.find(f".//{{{RDF}}}Description")
    if desc is None:
        raise ValueError(f"Missing RDF Description in {xmp_path}")

    def get(key: str, default: float = 0.0) -> float:
        return float(desc.get(f"{{{CRS}}}{key}", default))

    temp_k = get("Temperature", 5500)
    return {
        "exposure": get("Exposure2012"),
        "contrast": get("Contrast2012"),
        "highlights": get("Highlights2012"),
        "shadows": get("Shadows2012"),
        "whites": get("Whites2012"),
        "blacks": get("Blacks2012"),
        "temperature": (temp_k - 5500) / 2500 * 100,
        "tint": get("Tint") / 1.5,
        "vibrance": get("Vibrance"),
        "saturation": get("Saturation"),
        "sharpness": get("Sharpness", 40),
        "noise_reduction": get("LuminanceSmoothing"),
    }


def find_image(images_dir: Path, stem: str) -> Path | None:
    for suffix in (".jpg", ".jpeg", ".png", ".tif", ".tiff"):
        matches = list(images_dir.rglob(f"{stem}{suffix}")) + list(images_dir.rglob(f"{stem}{suffix.upper()}"))
        if matches:
            return matches[0]
    return None


def infer_expert(path: Path) -> str | None:
    text = str(path).lower()
    for expert in EXPERTS:
        if f"expert{expert.lower()}" in text or f"expert_{expert.lower()}" in text:
            return expert
    parts = [p.lower() for p in path.parts]
    for expert in EXPERTS:
        if expert.lower() in parts:
            return expert
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument("--xmp-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("data/processed/fivek_labels.csv"))
    args = parser.parse_args()

    rows = []
    for xmp_path in sorted(args.xmp_dir.rglob("*.xmp")):
        expert = infer_expert(xmp_path)
        if expert not in EXPERTS:
            continue
        image_path = find_image(args.images_dir, xmp_path.stem)
        if image_path is None:
            continue
        labels = parse_xmp(xmp_path)
        rows.append({
            "image_path": str(image_path),
            "expert": expert,
            "style": EXPERTS[expert],
            **{key: labels[key] for key in PARAM_KEYS},
        })

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["image_path", "expert", "style", *PARAM_KEYS])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {args.out}")


if __name__ == "__main__":
    main()
