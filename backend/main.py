import io
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from db import init_db, log_event
from image_processing import apply_params
from model import recommend_params

UPLOAD_DIR = Path("uploads")
RESULT_DIR = Path("results")
UPLOAD_DIR.mkdir(exist_ok=True)
RESULT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="PhotoTune API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/results", StaticFiles(directory="results"), name="results")


@app.on_event("startup")
def startup():
    init_db()


# ── Upload ────────────────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    image_id = str(uuid.uuid4())
    img = Image.open(io.BytesIO(await file.read())).convert("RGB")
    img.thumbnail((1920, 1920))
    img.save(UPLOAD_DIR / f"{image_id}.jpg", "JPEG", quality=90)
    return {"image_id": image_id, "url": f"/uploads/{image_id}.jpg"}


@app.post("/api/upload-batch")
async def upload_batch(files: list[UploadFile] = File(...)):
    results = []
    for file in files:
        image_id = str(uuid.uuid4())
        img = Image.open(io.BytesIO(await file.read())).convert("RGB")
        img.thumbnail((1920, 1920))
        img.save(UPLOAD_DIR / f"{image_id}.jpg", "JPEG", quality=90)
        results.append({"image_id": image_id, "url": f"/uploads/{image_id}.jpg"})
    return {"images": results}


# ── Recommend ─────────────────────────────────────────────────────────────────

class RecommendRequest(BaseModel):
    image_id: str
    session_id: str
    condition: str = "model_based"  # manual | rule_based | model_based


@app.post("/api/recommend")
def recommend(req: RecommendRequest):
    path = UPLOAD_DIR / f"{req.image_id}.jpg"
    if not path.exists():
        raise HTTPException(404, "Image not found")

    candidates = recommend_params(Image.open(path), condition=req.condition)
    log_event(req.session_id, req.image_id, "recommend", {"condition": req.condition})
    return {"candidates": candidates}


# ── Apply ─────────────────────────────────────────────────────────────────────

class ApplyRequest(BaseModel):
    image_id: str
    params: dict
    session_id: str | None = None


@app.post("/api/apply")
def apply(req: ApplyRequest):
    path = UPLOAD_DIR / f"{req.image_id}.jpg"
    if not path.exists():
        raise HTTPException(404, "Image not found")

    result = apply_params(Image.open(path), req.params)
    result_id = str(uuid.uuid4())
    result.save(RESULT_DIR / f"{result_id}.jpg", "JPEG", quality=92)

    if req.session_id:
        log_event(req.session_id, req.image_id, "apply", {"params": req.params})

    return {"result_url": f"/results/{result_id}.jpg"}


# ── Feedback ──────────────────────────────────────────────────────────────────

FEEDBACK_DELTA: dict[str, dict] = {
    "brighter":       {"exposure":    +0.4},
    "darker":         {"exposure":    -0.4},
    "warmer":         {"temperature": +20},
    "cooler":         {"temperature": -20},
    "more_contrast":  {"contrast":    +15},
    "less_contrast":  {"contrast":    -15},
    "more_saturated": {"saturation":  +15, "vibrance": +10},
    "less_saturated": {"saturation":  -15, "vibrance": -10},
}


class FeedbackRequest(BaseModel):
    image_id: str
    params: dict
    direction: str
    session_id: str | None = None


@app.post("/api/feedback")
def feedback(req: FeedbackRequest):
    delta = FEEDBACK_DELTA.get(req.direction)
    if delta is None:
        raise HTTPException(400, f"Unknown direction: {req.direction}")

    new_params = {**req.params}
    for k, v in delta.items():
        new_params[k] = new_params.get(k, 0) + v

    if req.session_id:
        log_event(req.session_id, req.image_id, "feedback", {
            "direction": req.direction,
            "params_after": new_params,
        })

    return {"params": new_params}


# ── Batch ─────────────────────────────────────────────────────────────────────

class BatchRequest(BaseModel):
    image_ids: list[str]
    params: dict
    session_id: str | None = None


@app.post("/api/batch")
def batch_apply(req: BatchRequest):
    results = []
    for image_id in req.image_ids:
        path = UPLOAD_DIR / f"{image_id}.jpg"
        if not path.exists():
            results.append({"image_id": image_id, "error": "not found"})
            continue
        result = apply_params(Image.open(path), req.params)
        result_id = str(uuid.uuid4())
        result.save(RESULT_DIR / f"{result_id}.jpg", "JPEG", quality=92)
        results.append({"image_id": image_id, "result_url": f"/results/{result_id}.jpg"})

    if req.session_id:
        log_event(req.session_id, None, "batch_apply", {"count": len(req.image_ids)})

    return {"results": results}
