# Backend Model Training (FiveK)

This document is for the CS568 backend/model-training role. It gives a reproducible pipeline that starts from MIT-Adobe FiveK files and ends with deployable PhotoTune model weights.

## 1) Prepare dataset files

Expected local layout:

```text
data/
  fivek/
    images/   # input images (jpg/tif/dng...)
    xmp/      # Lightroom XMP files from experts
```

## 2) Build training labels

```bash
python scripts/prepare_fivek.py \
  --images-dir data/fivek/images \
  --xmp-dir data/fivek/xmp \
  --out data/processed/fivek_labels.csv \
  --experts C,A,E
```

Output:
- `data/processed/fivek_labels.csv`
- Console summary: rows per expert + skipped counts.

## 3) Train linear baselines and export metrics

```bash
python scripts/train_linear_baseline.py \
  --labels data/processed/fivek_labels.csv \
  --out-dir backend/weights \
  --ridge 0.15 \
  --val-ratio 0.15 \
  --seed 42 \
  --metrics-out backend/weights/training_metrics.json
```

Outputs:
- `backend/weights/expertC_linear.npz` (Natural)
- `backend/weights/expertA_linear.npz` (Vivid)
- `backend/weights/expertE_linear.npz` (Cinematic)
- `backend/weights/training_metrics.json`

Each `.npz` stores:
- `weights` (ridge-regression matrix)
- `feature_mean` / `feature_std` (normalization stats)
- `param_keys`

## 4) Verify model path is active

Run backend and call recommendation endpoint. If the weight files exist, `backend/model.py` will use trained regressors. If not, it automatically falls back to deterministic image-statistics heuristics so demo is never blocked.

## 5) What to report in final write-up

- Training setup: features, regression objective, ridge coefficient, split ratio.
- Validation metric: MAE across 12 Lightroom-style sliders.
- Comparison baseline: mean-target predictor (included in metrics JSON as `baseline_mae_mean`).
- User-study condition mapping:
  - Expert C -> Natural
  - Expert A -> Vivid
  - Expert E -> Cinematic

## 6) Reproducibility checklist

- Fixed random seed (`--seed`)
- Fixed validation split (`--val-ratio`)
- Saved model normalization parameters (`feature_mean/std`)
- Saved machine-readable metrics (`training_metrics.json`)
