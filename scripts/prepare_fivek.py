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
import re
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

    def get_any(keys: tuple[str, ...], default: float = 0.0) -> float:
        for key in keys:
            value = desc.get(f"{{{CRS}}}{key}")
            if value is not None:
                return float(value)
        return float(default)

    temp_k = get_any(("Temperature",), 5500)
    return {
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


def build_image_index(images_dir: Path) -> dict[str, Path]:
    allowed_ext = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dng"}
    index: dict[str, Path] = {}
    for path in images_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in allowed_ext:
            continue
        index.setdefault(path.stem.lower(), path)
    return index


def find_image(image_index: dict[str, Path], xmp_path: Path) -> Path | None:
    stem = xmp_path.stem.lower()
    candidates = [stem]

    # Common naming variants: a0001.xmp / C_0001.xmp / expertA_0001.xmp.
    trimmed = re.sub(r"^(expert[_-]?)?[abcde][_-]?", "", stem)
    if trimmed and trimmed != stem:
        candidates.append(trimmed)

    digits = re.findall(r"\d+", stem)
    if digits:
        candidates.append(digits[-1].zfill(4))

    for candidate in candidates:
        match = image_index.get(candidate)
        if match is not None:
            return match
    return None


def infer_expert(path: Path) -> str | None:
    text = str(path).lower().replace("-", "_")
    for expert in EXPERTS:
        if f"expert{expert.lower()}" in text or f"expert_{expert.lower()}" in text:
            return expert
    m = re.search(r"(^|[_/])([abcde])([_/]|$)", text)
    if m and m.group(2).upper() in EXPERTS:
        return m.group(2).upper()
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
    parser.add_argument(
        "--experts",
        type=str,
        default="C,A,E",
        help="Comma-separated expert IDs to keep, e.g. C,A,E",
    )
    args = parser.parse_args()
    selected_experts = {item.strip().upper() for item in args.experts.split(",") if item.strip()}
    selected_experts &= set(EXPERTS.keys())
    if not selected_experts:
        raise ValueError("No valid experts selected. Use a subset of: A,C,E")

    rows = []
    counts = {expert: 0 for expert in selected_experts}
    skipped_missing_image = 0
    skipped_parse_error = 0
    skipped_unknown_expert = 0

    image_index = build_image_index(args.images_dir)
    if not image_index:
        raise ValueError(f"No images found in {args.images_dir}")

    for xmp_path in sorted(args.xmp_dir.rglob("*.xmp")):
        expert = infer_expert(xmp_path)
        if expert not in selected_experts:
            skipped_unknown_expert += 1
            continue

        image_path = find_image(image_index, xmp_path)
        if image_path is None:
            skipped_missing_image += 1
            continue

        try:
            labels = parse_xmp(xmp_path)
        except Exception:
            skipped_parse_error += 1
            continue

        rows.append({
            "image_path": str(image_path),
            "expert": expert,
            "style": EXPERTS[expert],
            **{key: labels[key] for key in PARAM_KEYS},
        })
        counts[expert] += 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["image_path", "expert", "style", *PARAM_KEYS])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {args.out}")
    print("Rows per expert:", {k: counts[k] for k in sorted(counts)})
    print(
        "Skipped:",
        {
            "unknown_or_unselected_expert": skipped_unknown_expert,
            "missing_image": skipped_missing_image,
            "parse_error": skipped_parse_error,
        },
    )


if __name__ == "__main__":
    main()
