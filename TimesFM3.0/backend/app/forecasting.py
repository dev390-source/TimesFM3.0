"""TimesFM 3.0 inference adapter plus an explicitly labelled local demo fallback."""
from __future__ import annotations

import os
import platform
from typing import Any

import numpy as np
import pandas as pd


def _seasonal_naive(values: np.ndarray, horizon: int, seasonal_period: int = 7):
    """Fallback used only when TIMESFM_ENABLED is not set."""
    if len(values) == 0:
        raise ValueError("No usable target values were found.")
    period = min(seasonal_period, len(values))
    pattern = values[-period:]
    forecast = np.tile(pattern, int(np.ceil(horizon / period)))[:horizon].astype(float)
    scale = max(float(np.nanstd(values[-min(len(values), 28):])), 1.0)
    spread = 0.35 * scale * np.sqrt(np.arange(1, horizon + 1) / max(horizon, 1))
    return forecast, forecast - spread, forecast + spread


def _timesfm_forecast(values: np.ndarray, horizon: int):
    """Load TimesFM 3.0 from the official `timesfm3` API."""
    checkpoint = os.getenv("TIMESFM_MODEL_ID", "google/timesfm-3.0-pytorch")
    backend = os.getenv("TIMESFM_BACKEND", "auto").lower()

    # Apple Silicon: use the official MLX backend unless explicitly overridden.
    is_apple_silicon = platform.system() == "Darwin" and platform.machine() in {"arm64", "aarch64"}
    if backend == "mlx" or (backend == "auto" and is_apple_silicon):
        try:
            from timesfm3.mlx import TimesFM3Forecaster
            model = TimesFM3Forecaster.from_pretrained(checkpoint)
            output = model.predict(
                values.astype(np.float32),
                horizon=horizon,
                return_quantiles=True,
            )
            point = np.asarray(output.forecast, dtype=float).reshape(-1)[:horizon]
            quantiles = np.asarray(output.quantiles, dtype=float)
            if quantiles.ndim == 2 and quantiles.shape[0] >= horizon and quantiles.shape[1] >= 9:
                lower, upper = quantiles[:horizon, 0], quantiles[:horizon, 8]
            else:
                lower, upper = point.copy(), point.copy()
            return point, lower, upper
        except Exception as exc:
            raise RuntimeError(
                "TimesFM 3.0 MLX inference failed. Install the MLX extra and verify "
                f"checkpoint access ({checkpoint}). Original error: {exc}"
            ) from exc

    try:
        from timesfm3 import TimesFM3Evaluator, ModelConfig
        device = os.getenv("TIMESFM_DEVICE", "cuda")
        config = ModelConfig(
            checkpoint_path=checkpoint,
            per_core_batch_size=int(os.getenv("TIMESFM_BATCH_SIZE", "1")),
            device=device,
        )
        model = TimesFM3Evaluator(config)
        output = list(model.predict_batch(
            contexts=[values.astype(np.float32)],
            horizon=horizon,
            return_quantiles=True,
            use_symmetric_averaging=False,
        ))[0]
        point = np.asarray(output.forecast, dtype=float).reshape(-1)[:horizon]
        quantiles = np.asarray(output.quantiles, dtype=float)
        if quantiles.ndim == 2 and quantiles.shape[0] >= horizon and quantiles.shape[1] >= 9:
            lower, upper = quantiles[:horizon, 0], quantiles[:horizon, 8]
        else:
            lower, upper = point.copy(), point.copy()
        return point, lower, upper
    except Exception as exc:
        raise RuntimeError(
            f"TimesFM 3.0 inference failed for '{checkpoint}' using backend '{backend}'. "
            "Check the installed TimesFM 3.0 dependencies, device and Hugging Face access. "
            f"Original error: {exc}"
        ) from exc


def _format_timestamp(value) -> str:
    ts = pd.Timestamp(value)
    if ts.hour or ts.minute or ts.second:
        return ts.strftime("%Y-%m-%d %H:%M:%S")
    return ts.strftime("%Y-%m-%d")


def forecast_series(series: pd.Series, horizon: int, dates: pd.DatetimeIndex) -> dict[str, Any]:
    values = pd.to_numeric(series, errors="coerce").dropna().to_numpy(dtype=float)
    if len(values) < 10:
        raise ValueError("Please upload at least 10 non-empty historical observations.")

    enabled = os.getenv("TIMESFM_ENABLED", "0").lower() in {"1", "true", "yes"}
    if enabled:
        point, lower, upper = _timesfm_forecast(values, horizon)
        engine, mode = "TimesFM 3.0", "model"
    else:
        point, lower, upper = _seasonal_naive(values, horizon)
        engine, mode = "Seasonal-naive demo", "demo"

    point = np.maximum(point, 0)
    lower = np.maximum(np.minimum(lower, point), 0)
    upper = np.maximum(np.maximum(upper, point), 0)
    return {
        "engine": engine,
        "mode": mode,
        "forecast": [
            {
                "date": _format_timestamp(dates[i]),
                "prediction": round(float(point[i]), 2),
                "lower": round(float(lower[i]), 2),
                "upper": round(float(upper[i]), 2),
            }
            for i in range(horizon)
        ],
    }
