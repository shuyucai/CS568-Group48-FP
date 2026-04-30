# Model Interface Spec

> For the model training team. Read this before writing any code.
> The only file you need to touch: `backend/model.py`

---

## What you need to implement

One function: `_model_inference(img)` in `backend/model.py`.

```python
def _model_inference(img: PIL.Image.Image) -> list[dict]:
    ...
```

### Input

A standard PIL RGB image. Any resolution — assume it's already been resized to max 1920px on the longest side.

```python
from PIL import Image
img = Image.open("photo.jpg").convert("RGB")  # this is what you receive
```

### Output

A list of **exactly 3 dicts**, each with a `name` (string) and `params` (dict of adjustment values).

```python
[
    {
        "name": "Natural",        # display name shown in UI — pick anything descriptive
        "params": {
            "exposure":         0.7,   # float, range -5.0 to +5.0
            "contrast":         10,    # int,   range -100 to +100
            "highlights":      -15,    # int,   range -100 to +100
            "shadows":          20,    # int,   range -100 to +100
            "whites":            5,    # int,   range -100 to +100
            "blacks":           -5,    # int,   range -100 to +100
            "temperature":       5,    # int,   range -100 to +100  (negative=cool, positive=warm)
            "tint":              0,    # int,   range -100 to +100  (negative=green, positive=magenta)
            "vibrance":         15,    # int,   range -100 to +100
            "saturation":        5,    # int,   range -100 to +100
            "sharpness":        40,    # int,   range 0 to 150
            "noise_reduction":  10,    # int,   range 0 to 100
        }
    },
    {
        "name": "Vivid",
        "params": { ... }
    },
    {
        "name": "Cinematic",
        "params": { ... }
    },
]
```

**Rules:**
- Always return exactly 3 candidates. The UI has 3 slots — more or fewer will break the layout.
- All 12 keys must be present in every `params` dict. Use `0` for parameters you don't adjust.
- The 3 candidates should be meaningfully different styles, not near-identical outputs.

---

## Where to put your model weights

Put them anywhere inside `backend/`. A `weights/` subdirectory is fine:

```
backend/
  weights/
    model.pt        ← your checkpoint
  model.py          ← your inference code goes here
```

Load once at module level so the model isn't reloaded on every request:

```python
import torch

_model = None

def _load_model():
    global _model
    if _model is None:
        _model = torch.load("weights/model.pt", map_location="cpu")
        _model.eval()
    return _model

def _model_inference(img):
    model = _load_model()
    # ... run inference ...
    return [
        {"name": "...", "params": {...}},
        {"name": "...", "params": {...}},
        {"name": "...", "params": {...}},
    ]
```

---

## How to test your implementation

```bash
cd backend
python3 - <<'EOF'
from PIL import Image
from model import recommend_params

img = Image.open("any_test_photo.jpg")
results = recommend_params(img, condition="model_based")

assert len(results) == 3, "must return exactly 3 candidates"
for r in results:
    assert "name" in r
    assert len(r["params"]) == 12, f"missing params in {r['name']}"
    print(r["name"], r["params"])

print("OK")
EOF
```

---

## What the params map to

These are the same as Adobe Lightroom sliders. The FiveK dataset XMP files record
these values directly — you can read them with `rawpy` or parse the XMP XML.

| param | Lightroom equivalent |
|---|---|
| exposure | Exposure |
| contrast | Contrast |
| highlights | Highlights |
| shadows | Shadows |
| whites | Whites |
| blacks | Blacks |
| temperature | Temperature (we normalize to -100…+100 from the raw Kelvin value) |
| tint | Tint |
| vibrance | Vibrance |
| saturation | Saturation |
| sharpness | Sharpening > Amount |
| noise_reduction | Noise Reduction > Luminance |

---

## Temperature normalization

The FiveK dataset stores temperature in Kelvin (e.g. 2800K–8000K).
Normalize to our -100…+100 range with neutral at 5500K:

```python
def kelvin_to_temp(kelvin: float) -> int:
    neutral = 5500
    span = 2500           # +/-2500K maps to +/-100
    return int((kelvin - neutral) / span * 100)
```
