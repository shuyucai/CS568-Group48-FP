# PhotoTune

PhotoTune is an interactive AI-assisted photo editing prototype for CS568 Group 48. It recommends global filter parameters for a single photo or a photo batch, lets users refine the style with quick feedback, and exports edited images.

## Implemented Features

- Upload one or more JPEG/PNG photos.
- Compare three study conditions: manual, rule-based, and model-based.
- Generate three candidate styles: Natural, Vivid, and Cinematic.
- Preview edits in the browser before final processing.
- Refine recommendations with feedback such as brighter, warmer, more contrast, or less color.
- Batch apply one consistent style to multiple photos.
- Log study events to SQLite for later analysis.

## Project Structure

```text
backend/
  main.py              FastAPI routes
  model.py             recommendation logic and optional trained-weight loader
  image_processing.py  Lightroom-style image adjustments
  db.py                SQLite event logging
frontend/
  src/
    pages/             upload and edit workflows
    components/        filter cards
    utils/             canvas preview renderer
scripts/
  prepare_fivek.py     parse FiveK XMP labels
  train_linear_baseline.py
docs/
  user-study.md
```

## Run Locally

Start the backend:

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Start the frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

Quick backend sanity check:

```bash
curl http://localhost:8000/api/health
```

## Model Path

`backend/model.py` first looks for trained lightweight FiveK models:

```text
backend/weights/expertC_linear.npz  Natural
backend/weights/expertA_linear.npz  Vivid
backend/weights/expertE_linear.npz  Cinematic
```

If these files are not present, PhotoTune uses a deterministic image-statistics recommender so the demo still works end to end.

## FiveK Dataset

Download MIT-Adobe FiveK from:

https://data.csail.mit.edu/graphics/fivek/

Prepare labels:

```bash
python scripts/prepare_fivek.py \
  --images-dir data/fivek/images \
  --xmp-dir data/fivek/xmp \
  --out data/processed/fivek_labels.csv
```

Train the dependency-light baseline:

```bash
python scripts/train_linear_baseline.py \
  --labels data/processed/fivek_labels.csv \
  --out-dir backend/weights \
  --val-ratio 0.15 \
  --seed 42 \
  --metrics-out backend/weights/training_metrics.json
```

The parser uses experts C, A, and E as Natural, Vivid, and Cinematic respectively.
Detailed backend model workflow is in `docs/model-training.md`.

### Low-Disk Incremental Training (part-by-part)

If disk space is limited, you can process dataset parts sequentially and delete each part after accumulation:

```bash
# for each extracted part folder that contains images/ and xmp/
python scripts/train_linear_incremental.py \
  --mode accumulate \
  --part-dir data/fivek_part_01 \
  --state backend/weights/incremental_state.npz

# after all parts are accumulated
python scripts/train_linear_incremental.py \
  --mode finalize \
  --state backend/weights/incremental_state.npz \
  --out-dir backend/weights \
  --metrics-out backend/weights/training_metrics_incremental.json
```

## Evaluation

The planned user study compares manual editing, rule-based suggestions, and model-based recommendations. See `docs/user-study.md` for the protocol and metrics.
