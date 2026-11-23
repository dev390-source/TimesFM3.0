# Frostline Demand Planner · TimesFM 3.0 starter

A local full-stack CSV forecasting workspace inspired by the supplied Frostline Creamery dashboard.

## What is included

- Responsive dashboard UI with product tabs, driver toggles, forecast chart, history/forecast boundary, confidence band, dataset inspection and CSV upload.
- FastAPI backend with CSV inspection, forecasting, and health endpoints.
- TimesFM 3.0 adapter isolated in `backend/app/forecasting.py`.
- Sample daily demand CSV so the UI can be explored immediately.
- Demo mode: if TimesFM is not installed/configured, the API returns a clearly labelled seasonal-naive forecast. It does **not** pretend that this is a TimesFM prediction.

## CSV format

Minimum required columns:
- `date`: daily timestamp
- one numeric target column, e.g. `sales`

Example:

```csv
date,sales
2026-01-01,120
2026-01-02,135
```

Optional numeric covariates can be included, but the first version forecasts one selected target series. The selected target is sent as the TimesFM context. Future covariates are not yet wired into the TimesFM call.

## Run locally

### 1. Create and activate a virtual environment

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # macOS/Linux
# .venv\Scripts\activate        # Windows
```

### 2. Install API dependencies

```bash
pip install -r requirements.txt
```

### 3. Install TimesFM 3.0

Follow the official Google Research TimesFM repository instructions for installation and checkpoint access:
https://github.com/google-research/timesfm

The adapter uses the current official `timesfm3` API (`TimesFM3Forecaster` for MLX or `TimesFM3Evaluator` for PyTorch). On Apple Silicon, MLX is selected automatically by default. Set:

```bash
export TIMESFM_ENABLED=1
export TIMESFM_MODEL_ID=google/timesfm-3.0-pytorch
# Optional: TIMESFM_BACKEND=mlx or torch
# Optional for PyTorch: TIMESFM_DEVICE=cuda (or cpu)
```

If your installed release uses a different class/checkpoint identifier, update those two settings and the adapter. The app intentionally starts in demo mode until explicitly enabled. **License warning:** the self-hosted TimesFM 3.0 weights are distributed under a non-commercial license. Do not use downloaded weights for commercial or production workloads unless you have separately confirmed that your usage is permitted. Google's BigQuery-hosted TimesFM offering has separate commercial terms.

### 4. Start the API

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 5. Open the frontend

Open `frontend/index.html` in a browser. If the browser blocks local API calls, serve the frontend:

```bash
python -m http.server 5500 --directory ../frontend
```

Then open http://127.0.0.1:5500.

API docs: http://127.0.0.1:8000/docs

## API

- `GET /api/health`
- `POST /api/inspect` multipart form: `file`
- `POST /api/forecast` multipart form:
  - `file`
  - `date_column`
  - `target_column`
  - `horizon`
  - `frequency` (`D`, `W`, `MS`, etc.)

## Important modelling notes

- The backend sorts dates, aggregates duplicate dates using sum, reindexes to a regular frequency, and fills missing target observations with zero. Review this default for your business meaning before production use.
- No train/test evaluation or hyperparameter tuning is performed by this interactive inference demo. Add a rolling-origin backtest before using forecasts for planning.
- The TimesFM 3.0 model is pretrained. This starter uses zero-shot inference; fine-tuning is a separate workflow.
- Large CSVs and model inference should be moved to background jobs (Celery/RQ) for production.

## Project layout

```text
.
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       └── forecasting.py
└── sample_data/
    └── sample_daily_demand.csv
```
