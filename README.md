in frontend new feature branch
# PhotoTune — CS568 Group 48 Final Project

Interactive AI-assisted photo filter recommendation system.

---

## Local Setup

### Requirements

- Python 3.11+
- Node.js 18+ (install via [nvm](https://github.com/nvm-sh/nvm) or [nodejs.org](https://nodejs.org))

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend runs at `http://localhost:8000`.  
API docs at `http://localhost:8000/docs`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.  
Open this URL in your browser — both servers must be running at the same time.

### File layout after setup

```
backend/
  uploads/     ← user-uploaded photos (auto-created)
  results/     ← processed output photos (auto-created)
  weights/     ← put your trained .pt files here (see Model section)
  phototune.db ← SQLite log for user study (auto-created)
```

---

## API Overview

| Endpoint | Method | What it does |
|---|---|---|
| `/api/upload-batch` | POST | Upload one or more photos |
| `/api/recommend` | POST | Get 3 filter candidates for a photo |
| `/api/apply` | POST | Apply params → return processed image URL |
| `/api/batch` | POST | Apply same params to multiple photos |
| `/api/feedback` | POST | Nudge params in a direction (brighter, warmer…) |

---

## For the Model Team

### What to implement

Open `backend/model.py` and replace the `_model_inference` function.  
**That is the only file you need to touch.**

```python
def _model_inference(img: PIL.Image.Image) -> list[dict]:
    ...
```

### Input

A standard PIL RGB image. Already resized to max 1920px on the longest side.

```python
from PIL import Image
img = Image.open("photo.jpg").convert("RGB")   # this is what you receive
```

### Output

A list of **exactly 3 dicts**, each with a display name and 12 adjustment parameters.

```python
[
    {
        "name": "Natural",      # shown in the UI card
        "params": {
            "exposure":          0.70,   # float  –5.0  → +5.0
            "contrast":          10,     # int   –100  → +100
            "highlights":       -15,     # int   –100  → +100
            "shadows":           20,     # int   –100  → +100
            "whites":             5,     # int   –100  → +100
            "blacks":            -5,     # int   –100  → +100
            "temperature":        5,     # int   –100  → +100  (neg = cool, pos = warm)
            "tint":               0,     # int   –100  → +100  (neg = green, pos = magenta)
            "vibrance":          15,     # int   –100  → +100
            "saturation":         5,     # int   –100  → +100
            "sharpness":         40,     # int      0  → 150
            "noise_reduction":   10,     # int      0  → 100
        }
    },
    { "name": "Vivid",     "params": { ... } },
    { "name": "Cinematic", "params": { ... } },
]
```

Rules:
- Always return exactly **3 candidates**. The UI has 3 fixed slots.
- All **12 keys must be present** in every params dict. Use `0` for anything you don't adjust.
- The 3 candidates should look visually distinct — avoid near-identical outputs.

---

### FiveK Dataset — Parameters to Labels

The FiveK XMP files record Lightroom slider values directly. Parse them like this:

```python
import xml.etree.ElementTree as ET

CRS = "http://ns.adobe.com/camera-raw-settings/1.0/"

def parse_xmp(xmp_path: str) -> dict:
    tree = ET.parse(xmp_path)
    root = tree.getroot()
    desc = root.find(".//{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Description")

    def get(key, default=0.0):
        return float(desc.get(f"{{{CRS}}}{key}", default))

    temp_k = get("Temperature", 5500)

    return {
        "exposure":        get("Exposure2012"),
        "contrast":        get("Contrast2012"),
        "highlights":      get("Highlights2012"),
        "shadows":         get("Shadows2012"),
        "whites":          get("Whites2012"),
        "blacks":          get("Blacks2012"),
        "temperature":     (temp_k - 5500) / 2500 * 100,  # Kelvin → –100…+100
        "tint":            get("Tint") / 1.5,              # Lightroom range ±150 → ±100
        "vibrance":        get("Vibrance"),
        "saturation":      get("Saturation"),
        "sharpness":       get("Sharpness", 40),
        "noise_reduction": get("LuminanceSmoothing"),
    }
```

**Which experts to use:**

| UI card name | FiveK expert | Why |
|---|---|---|
| Natural | Expert C | Most consistent, closest to "correct" edit — used in most papers |
| Vivid | Expert A | More aggressive color boost |
| Cinematic | Expert E | More stylized, highest variance from C |

Train one model per expert → 3 `.pt` files → 3 distinct styles in the UI.

---

### Recommended Model Architecture

```python
import torch
import torch.nn as nn
from torchvision import models, transforms

PARAM_KEYS = [
    "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
    "temperature", "tint", "vibrance", "saturation", "sharpness", "noise_reduction",
]

# Max absolute value per param — used to scale Tanh output
PARAM_SCALES = torch.tensor([
    5.0, 100.0, 100.0, 100.0, 100.0, 100.0,
    100.0, 100.0, 100.0, 100.0, 75.0, 50.0,
])

class PhotoTuneModel(nn.Module):
    def __init__(self):
        super().__init__()
        backbone = models.efficientnet_b0(weights="IMAGENET1K_V1")
        self.features = backbone.features
        self.pool     = backbone.avgpool
        self.head     = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(1280, 12),
            nn.Tanh(),          # output in [–1, 1], then scaled by PARAM_SCALES
        )

    def forward(self, x):
        x = self.pool(self.features(x)).flatten(1)
        return self.head(x) * PARAM_SCALES.to(x.device)


TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])
```

Training (one model per expert):

```python
model    = PhotoTuneModel()
optim    = torch.optim.Adam(model.parameters(), lr=1e-4)
loss_fn  = torch.nn.MSELoss()

for epoch in range(50):
    for imgs, labels in dataloader:   # labels shape: [B, 12]
        pred = model(imgs)
        loss = loss_fn(pred, labels)
        optim.zero_grad(); loss.backward(); optim.step()

torch.save(model.state_dict(), "backend/weights/expertC.pt")
# repeat for expertA.pt and expertE.pt
```

---

### Plugging the model into the backend

Replace `_model_inference` in `backend/model.py`:

```python
import torch
from torchvision import transforms
from PIL import Image
# from your_training_file import PhotoTuneModel, PARAM_KEYS, TRANSFORM

_loaded = {}

def _load(expert: str):
    if expert not in _loaded:
        m = PhotoTuneModel()
        m.load_state_dict(torch.load(f"weights/{expert}.pt", map_location="cpu"))
        m.eval()
        _loaded[expert] = m
    return _loaded[expert]

def _infer(model, img: Image.Image) -> dict:
    tensor = TRANSFORM(img).unsqueeze(0)
    with torch.no_grad():
        pred = model(tensor).squeeze(0).tolist()
    return {k: round(v, 1) for k, v in zip(PARAM_KEYS, pred)}

def _model_inference(img: Image.Image) -> list[dict]:
    return [
        {"name": "Natural",   "params": _infer(_load("expertC"), img)},
        {"name": "Vivid",     "params": _infer(_load("expertA"), img)},
        {"name": "Cinematic", "params": _infer(_load("expertE"), img)},
    ]
```

Put the three `.pt` files in `backend/weights/` and it works end-to-end.

### Verify before handing off

```bash
cd backend
python3 - <<'EOF'
from PIL import Image
from model import recommend_params

img = Image.open("any_photo.jpg")
results = recommend_params(img, condition="model_based")

assert len(results) == 3, "must return exactly 3 candidates"
for r in results:
    assert set(r["params"].keys()) == {
        "exposure","contrast","highlights","shadows","whites","blacks",
        "temperature","tint","vibrance","saturation","sharpness","noise_reduction"
    }, f"missing keys in {r['name']}"
    print(r["name"], {k: v for k,v in r["params"].items() if v != 0})

print("\nAll checks passed.")
EOF
```

---

## User Study Conditions

| Condition | Behavior |
|---|---|
| `model_based` | AI recommends 3 filters → user adjusts intensity + fine-tunes |
| `manual` | No suggestions — user adjusts all sliders from scratch |

All interactions are logged to `backend/phototune.db` (SQLite).  
Query the log after the study:

```sql
SELECT session_id, event_type, ts, payload
FROM events
ORDER BY session_id, ts;
```
