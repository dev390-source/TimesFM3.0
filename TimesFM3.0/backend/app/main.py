from __future__ import annotations

import io
from datetime import timedelta

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .forecasting import forecast_series

app = FastAPI(title="Frostline Demand Planner API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this in production.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def read_csv_upload(contents: bytes) -> pd.DataFrame:
    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read CSV: {exc}")
    if df.empty:
        raise HTTPException(status_code=400, detail="The uploaded CSV is empty.")
    df.columns = [str(c).strip() for c in df.columns]
    return df


def format_timestamp(value) -> str:
    ts = pd.Timestamp(value)
    if ts.hour or ts.minute or ts.second:
        return ts.strftime("%Y-%m-%d %H:%M:%S")
    return ts.strftime("%Y-%m-%d")


def prepare_series(df: pd.DataFrame, date_column: str, target_column: str, frequency: str):
    if date_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"Date column '{date_column}' was not found.")
    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"Target column '{target_column}' was not found.")
    dates = pd.to_datetime(df[date_column], errors="coerce")
    target = pd.to_numeric(df[target_column], errors="coerce")
    clean = pd.DataFrame({"date": dates, "target": target}).dropna(subset=["date", "target"])
    if clean.empty:
        raise HTTPException(status_code=400, detail="No valid date/target rows remain after parsing.")
    clean = clean.groupby("date", as_index=False)["target"].sum().sort_values("date")
    try:
        indexed = clean.set_index("date")["target"].asfreq(frequency)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid or unsupported frequency '{frequency}': {exc}")
    missing_count = int(indexed.isna().sum())
    indexed = indexed.fillna(0.0)
    return indexed, missing_count


def calculate_holdout_metrics(series: pd.Series, requested_horizon: int):
    """
    Evaluate the selected forecasting engine on the most recent historical
    holdout. This is a single-origin backtest, not training-set accuracy.
    """
    n_observations = len(series)
    # Keep at least 10 observations in the model context. Use at most the
    # requested forecast horizon and approximately the final 20% as holdout.
    holdout_size = min(
        requested_horizon,
        max(1, n_observations // 5),
        max(0, n_observations - 10),
    )
    if holdout_size < 1:
        return {
            "wape": None,
            "mae": None,
            "mape": None,
            "observations": 0,
            "method": "single_holdout",
            "note": "At least 11 historical observations are required for holdout evaluation.",
        }

    train = series.iloc[:-holdout_size]
    actual = series.iloc[-holdout_size:].to_numpy(dtype=float)
    evaluation_dates = pd.DatetimeIndex(series.index[-holdout_size:])

    evaluation = forecast_series(train, holdout_size, evaluation_dates)
    predicted = np.asarray(
        [row["prediction"] for row in evaluation["forecast"]],
        dtype=float,
    )

    absolute_errors = np.abs(actual - predicted)
    denominator = float(np.sum(np.abs(actual)))
    wape = (float(np.sum(absolute_errors)) / denominator * 100.0) if denominator else None
    mae = float(np.mean(absolute_errors)) if len(absolute_errors) else None

    nonzero_mask = np.abs(actual) > 1e-12
    mape = (
        float(np.mean(absolute_errors[nonzero_mask] / np.abs(actual[nonzero_mask])) * 100.0)
        if np.any(nonzero_mask)
        else None
    )

    return {
        "wape": round(wape, 4) if wape is not None else None,
        "mae": round(mae, 6) if mae is not None else None,
        "mape": round(mape, 4) if mape is not None else None,
        "observations": int(holdout_size),
        "method": "single_holdout",
        "start_date": evaluation_dates[0].isoformat(),
        "end_date": evaluation_dates[-1].isoformat(),
        "engine": evaluation["engine"],
        "mode": evaluation["mode"],
        "test_predictions": [
            {
                "date": format_timestamp(evaluation_dates[i]),
                "actual": round(float(actual[i]), 6),
                "prediction": round(float(predicted[i]), 6),
                "lower": round(float(evaluation["forecast"][i]["lower"]), 6),
                "upper": round(float(evaluation["forecast"][i]["upper"]), 6),
            }
            for i in range(holdout_size)
        ],
        "note": f"Evaluated on the most recent {holdout_size} historical observations.",
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Frostline Demand Planner API"}


@app.post("/api/inspect")
async def inspect_dataset(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")
    df = read_csv_upload(await file.read())
    numeric = df.select_dtypes(include=[np.number]).columns.tolist()
    date_candidates = []
    for col in df.columns:
        if col in numeric:
            continue
        parsed = pd.to_datetime(df[col], errors="coerce")
        if parsed.notna().mean() >= 0.7:
            date_candidates.append(col)
    preview = df.head(8).replace({np.nan: None}).to_dict(orient="records")
    return {
        "filename": file.filename,
        "rows": int(len(df)),
        "columns": [
            {"name": str(c), "dtype": str(df[c].dtype), "numeric": c in numeric}
            for c in df.columns
        ],
        "numeric_columns": numeric,
        "date_candidates": date_candidates,
        "preview": preview,
    }


@app.post("/api/forecast")
async def run_forecast(
    file: UploadFile = File(...),
    date_column: str = Form(...),
    target_column: str = Form(...),
    horizon: int = Form(28),
    frequency: str = Form("D"),
):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")
    if horizon < 1 or horizon > 365:
        raise HTTPException(status_code=400, detail="Forecast horizon must be between 1 and 365.")
    df = read_csv_upload(await file.read())
    series, missing_count = prepare_series(df, date_column, target_column, frequency)
    try:
        evaluation_metrics = calculate_holdout_metrics(series, horizon)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=f"Backtest evaluation failed: {exc}")
    future_dates = pd.date_range(
        start=series.index[-1] + pd.tseries.frequencies.to_offset(frequency),
        periods=horizon,
        freq=frequency,
    )
    try:
        result = forecast_series(series, horizon, future_dates)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    history = [
        {"date": format_timestamp(idx), "actual": round(float(value), 2)}
        for idx, value in series.items()
    ]
    return {
        **result,
        "evaluation_metrics": evaluation_metrics,
        "target": target_column,
        "date_column": date_column,
        "frequency": frequency,
        "horizon": horizon,
        "history": history,
        "history_count": len(history),
        "filled_missing_periods": missing_count,
        "last_observation": history[-1]["date"],
    }
