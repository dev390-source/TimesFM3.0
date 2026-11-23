
import numpy as np
from timesfm3.mlx import TimesFM3Forecaster

print("Loading TimesFM 3.0...")

model = TimesFM3Forecaster.from_pretrained(
    "google/timesfm-3.0-pytorch"
)

print("Model loaded successfully!")

context = np.sin(np.linspace(0, 40, 512)).astype(np.float32)

result = model.predict(
    context=context,
    horizon=24,
    return_quantiles=True
)

print("\nForecast:")
print(result.forecast)

print("\nQuantiles shape:")
print(result.quantiles.shape)
