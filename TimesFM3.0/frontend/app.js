const API_BASE = "http://127.0.0.1:8000";
let selectedFile = null;
let forecastResult = null;
let chart = null;
let chartViewMode = "scroll";
let chartWindowStart = 0;
let inspected = null;
const $ = (id) => document.getElementById(id);

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}
function setBusy(busy) {
  $("runBtn").disabled = busy; $("inspectBtn").disabled = busy;
  $("runBtn").innerHTML = busy ? "◌ &nbsp;Working…" : "ϟ &nbsp;Run Forecast <span>↻</span>";
}
async function checkApi() {
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    if (!r.ok) throw new Error();
    $("modelStatus").textContent = "API connected";
    $("modelStatus").style.color = "#25855e";
  } catch {
    $("modelStatus").textContent = "API offline";
    $("modelStatus").style.color = "#c14b5e";
  }
}
function setFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".csv")) return toast("Please choose a CSV file.");
  if (file.size > 25 * 1024 * 1024) return toast("CSV is larger than the 25 MB starter limit.");
  selectedFile = file; forecastResult = null;
  $("fileName").textContent = file.name;
  $("fileDetails").textContent = `${(file.size / 1024).toFixed(1)} KB · ready to inspect`;
  $("fileCheck").textContent = "✓";
  $("uploadMessage").textContent = "CSV selected. Inspect the dataset to detect date and numeric columns.";
  $("forecastTablePanel").classList.add("hidden");
  $("timelineSlider").disabled = true;
  $("timelineSlider").value = "1000";
  $("timelineSliderHint").textContent = "Run a forecast to navigate the timeline";
  $("emptyState").style.display = "flex";
  if (chart) { chart.destroy(); chart = null; }
  $("historyCount").textContent = "--"; $("forecastAvg").textContent = "--"; $("forecastTotal").textContent = "--";
  $("wapeValue").innerHTML = `--<small>%</small>`;
  $("maeValue").innerHTML = `--<small id="maeUnit">units</small>`;
  $("mapeValue").innerHTML = `--<small>%</small>`;
  $("wapeNote").textContent = "Awaiting backtest evaluation";
  $("maeNote").textContent = "Awaiting backtest evaluation";
  $("mapeNote").textContent = "Awaiting backtest evaluation";
  toast(`${file.name} added to the workspace`);
}
$("dropzone").addEventListener("click", () => $("fileInput").click());
$("emptyUploadBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", e => setFile(e.target.files[0]));
$("dropzone").addEventListener("dragover", e => { e.preventDefault(); $("dropzone").style.borderColor = "#d94a66"; });
$("dropzone").addEventListener("dragleave", () => $("dropzone").style.borderColor = "");
$("dropzone").addEventListener("drop", e => { e.preventDefault(); $("dropzone").style.borderColor = ""; setFile(e.dataTransfer.files[0]); });

async function inspectDataset() {
  if (!selectedFile) return toast("Upload a CSV first.");
  const form = new FormData(); form.append("file", selectedFile);
  $("inspectBtn").disabled = true; $("inspectBtn").textContent = "Inspecting…";
  try {
    const response = await fetch(`${API_BASE}/api/inspect`, { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Dataset inspection failed.");
    inspected = data;
    fillSelect($("dateColumn"), data.date_candidates, "Select date column");
    fillSelect($("targetColumn"), data.numeric_columns, "Select target metric");
    if (data.date_candidates.length) $("dateColumn").value = data.date_candidates[0];
    if (data.numeric_columns.length) $("targetColumn").value = data.numeric_columns[0];
    $("fileDetails").textContent = `${data.rows.toLocaleString()} rows · ${data.columns.length} columns · inspected`;
    $("uploadMessage").textContent = `Found ${data.rows.toLocaleString()} rows, ${data.date_candidates.length} possible date column(s), and ${data.numeric_columns.length} numeric target(s).`;
    $("inspectSummary").textContent = `${data.filename} · ${data.rows.toLocaleString()} rows · ${data.columns.length} columns`;
    renderPreview(data);
    $("inspectPanel").classList.remove("hidden");
    toast("Dataset inspected. Choose your target and run the forecast.");
  } catch (error) { toast(error.message); }
  finally { $("inspectBtn").disabled = false; $("inspectBtn").innerHTML = "▤ &nbsp;Inspect Dataset"; }
}
function fillSelect(select, values, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function renderPreview(data) {
  const cols = data.columns.map(c => c.name);
  $("previewTable").innerHTML = `<thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${data.preview.map(row => `<tr>${cols.map(c => `<td>${escapeHtml(row[c] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody>`;
}
$("inspectBtn").addEventListener("click", inspectDataset);
$("closeInspect").addEventListener("click", () => $("inspectPanel").classList.add("hidden"));

async function runForecast() {
  if (!selectedFile) return toast("Upload a CSV before forecasting.");
  if (!$("dateColumn").value || !$("targetColumn").value) return toast("Inspect the CSV and select a date and target column.");
  const form = new FormData();
  form.append("file", selectedFile);
  form.append("date_column", $("dateColumn").value);
  form.append("target_column", $("targetColumn").value);
  form.append("horizon", $("horizon").value);
  form.append("frequency", $("frequency").value);
  setBusy(true);
  try {
    const response = await fetch(`${API_BASE}/api/forecast`, { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Forecast failed.");
    forecastResult = data;
    chartViewMode = "scroll";
    renderForecast(data);
    toast(`${data.engine} forecast generated.`);
  } catch (error) { toast(error.message); }
  finally { setBusy(false); }
}
$("runBtn").addEventListener("click", runForecast);

function renderForecast(data) {
  if (typeof Chart === "undefined") {
    toast("Chart.js did not load. Check your internet connection and refresh the page.");
    console.error("Chart.js is unavailable. The Chart.js CDN script may have failed to load.");
    return;
  }
  $("emptyState").style.display = "none";
  const history = data.history, future = data.forecast;
  const labels = [...history.map(x => x.date), ...future.map(x => x.date)];
  const actualValues = [...history.map(x => x.actual), ...Array(future.length).fill(null)];
  const predicted = [...Array(history.length).fill(null), ...future.map(x => x.prediction)];
  const lower = [...Array(history.length).fill(null), ...future.map(x => x.lower)];
  const upper = [...Array(history.length).fill(null), ...future.map(x => x.upper)];
  const ctx = $("forecastChart").getContext("2d");
  if (chart) chart.destroy();
  const chartScroll = $("chartScroll");
  const chartInner = $("chartInner");
  const chartCanvas = $("forecastChart");
  const viewportWidth = Math.max(chartScroll.getBoundingClientRect().width, chartScroll.clientWidth, 600);
  const chartHeight = Math.max(chartScroll.clientHeight, 280);
  // Allocate horizontal room per timestamp so dense intraday history remains readable.
  // Keep the backing canvas below common browser canvas dimension limits.
  // 3px per observation preserves a useful horizontal-scroll experience
  // while avoiding blank canvases for several thousand historical points.
  const maxCanvasWidth = 16000;
  const chartWidth = chartViewMode === "scroll"
    ? Math.max(viewportWidth, Math.min(labels.length * 3, maxCanvasWidth))
    : viewportWidth;
  const horizonWindow = Math.min(labels.length, Math.max(future.length * 4, 160));
  const horizonMaxStart = Math.max(0, labels.length - horizonWindow);
  if (chartViewMode === "horizon") {
    chartWindowStart = Math.max(0, Math.min(chartWindowStart, horizonMaxStart));
  } else {
    chartWindowStart = 0;
  }
  chartInner.style.width = `${chartWidth}px`;
  chartCanvas.width = chartWidth;
  chartCanvas.height = chartHeight;
  chartCanvas.style.width = `${chartWidth}px`;
  chartCanvas.style.height = `${chartHeight}px`;
  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [
      { label: "Past data", data: actualValues, borderColor: "#17212e", backgroundColor: "#17212e", borderWidth: 2.2, pointRadius: 0, pointHoverRadius: 4, tension: .18 },
      { label: "Upper range", data: upper, borderColor: "rgba(215,47,80,.15)", backgroundColor: "rgba(215,47,80,.12)", borderWidth: 1, borderDash: [4,4], pointRadius: 0, fill: "+1", tension: .18 },
      { label: "Lower range", data: lower, borderColor: "rgba(215,47,80,.2)", backgroundColor: "rgba(215,47,80,.10)", borderWidth: 1, borderDash: [4,4], pointRadius: 0, fill: false, tension: .18 },
      { label: "TimesFM 3.0 forecast", data: predicted, borderColor: "#d72f50", backgroundColor: "#d72f50", borderWidth: 3, pointRadius: 0, pointHoverRadius: 5, tension: .18, spanGaps: false }
    ]},
    options: {
      responsive: false, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#172536", padding: 11, titleFont: { family: "DM Sans" }, bodyFont: { family: "DM Sans" } } },
      scales: {
        x: {
          min: chartViewMode === "horizon" ? chartWindowStart : undefined,
          max: chartViewMode === "horizon" ? Math.min(labels.length - 1, chartWindowStart + horizonWindow - 1) : undefined,
          grid: { display: false },
          ticks: { maxTicksLimit: 9, maxRotation: 0, color: "#87919a", font: { size: 9 } }
        },
        y: { grid: { color: "#edf0f2", drawBorder: false }, ticks: { color: "#87919a", font: { size: 9 }, callback: v => Number(v).toLocaleString() } }
      }
    }
  });
  const vals = future.map(x => x.prediction), total = vals.reduce((a,b)=>a+b,0);
  $("historyCount").textContent = history.length.toLocaleString();
  $("lastObservationStat").textContent = data.last_observation || "--";
  $("forecastAvg").textContent = formatNumber(total / vals.length);
  $("forecastTotal").textContent = formatNumber(total);
  updateTopConfigCards();
  updateEvaluationCards(data);
  $("engineLabel").textContent = data.engine;
  $("engineDescription").textContent = data.mode === "demo" ? "Demo fallback active. Enable TimesFM in the API environment for model inference." : "Zero-shot pretrained model inference.";
  $("historyDate").textContent = `History through ${data.last_observation}`;
  $("futureDate").textContent = `${future[0].date} → ${future[future.length-1].date}`;
  $("forecastSpan").textContent = `${future.length} PERIOD FORECAST`;
  $("historyTrack").style.width = `${Math.max(20, history.length / (history.length + future.length) * 100)}%`;
  $("futureTrack").style.width = `${100 - parseFloat($("historyTrack").style.width)}%`;
  renderForecastTable(data);
  $("forecastTablePanel").classList.remove("hidden");
  $("modelName").textContent = data.engine;
  const slider = $("timelineSlider");
  const sliderHint = $("timelineSliderHint");
  slider.disabled = chartViewMode === "fit";
  if (chartViewMode === "horizon") {
    slider.max = String(horizonMaxStart);
    slider.value = String(chartWindowStart);
    sliderHint.textContent = `Focused view · ${horizonWindow.toLocaleString()} periods visible`;
  } else if (chartViewMode === "scroll") {
    slider.max = "1000";
    slider.value = "1000";
    sliderHint.textContent = "Drag to move through history and forecast";
    chartScroll.scrollLeft = chartScroll.scrollWidth;
  } else {
    slider.max = "1000";
    slider.value = "1000";
    sliderHint.textContent = "Full history fitted into the chart";
  }
  updateChartToolStates();
}
function formatNumber(value) { return Number(value).toLocaleString(undefined,{maximumFractionDigits:1}); }
function renderForecastTable(data) {
  const testRows = data.evaluation_metrics?.test_predictions || [];
  const testSection = testRows.length ? `
    <tr class="table-section-row"><td colspan="6">Historical test · ${testRows.length.toLocaleString()} held-out observations</td></tr>
    ${testRows.map(row => `
      <tr class="test-actual-row">
        <td>${escapeHtml(row.date)}</td>
        <td><span class="row-tag test-tag">Test</span></td>
        <td>${formatNumber(row.actual)}</td>
        <td><b>${formatNumber(row.prediction)}</b></td>
        <td>${formatNumber(row.lower)}</td>
        <td>${formatNumber(row.upper)}</td>
      </tr>`).join("")}` : "";
  const futureSection = `
    <tr class="table-section-row"><td colspan="6">Future forecast · ${data.forecast.length.toLocaleString()} periods</td></tr>
    ${data.forecast.map(row => `
      <tr class="future-forecast-row">
        <td>${escapeHtml(row.date)}</td>
        <td><span class="row-tag future-tag">Future</span></td>
        <td class="muted-cell">Not available</td>
        <td><b>${formatNumber(row.prediction)}</b></td>
        <td>${formatNumber(row.lower)}</td>
        <td>${formatNumber(row.upper)}</td>
      </tr>`).join("")}`;
  $("forecastTable").innerHTML = `
    <thead><tr><th>Date</th><th>Row type</th><th>Test actual</th><th>Predicted</th><th>Lower range</th><th>Upper range</th></tr></thead>
    <tbody>${testSection}${futureSection}</tbody>`;
}
$("downloadBtn").addEventListener("click", () => {
  if (!forecastResult) return;
  const testRows = forecastResult.evaluation_metrics?.test_predictions || [];
  const rows = [
    ["date","row_type","test_actual","prediction","lower","upper"],
    ...testRows.map(x=>[x.date,"historical_test",x.actual,x.prediction,x.lower,x.upper]),
    ...forecastResult.forecast.map(x=>[x.date,"future_forecast","",x.prediction,x.lower,x.upper])
  ];
  const csv = rows.map(row=>row.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  const a = document.createElement("a"); a.href=url; a.download="timesfm_forecast.csv"; a.click(); URL.revokeObjectURL(url);
});
function updateChartToolStates() {
  $("fitBtn").classList.toggle("active", chartViewMode === "fit");
  $("zoomBtn").classList.toggle("active", chartViewMode === "horizon");
}

$("fitBtn").addEventListener("click", () => {
  if (!forecastResult) return;
  chartViewMode = "fit";
  renderForecast(forecastResult);
  $("chartScroll").scrollLeft = 0;
});

$("zoomBtn").addEventListener("click", () => {
  if (!forecastResult) return;
  chartViewMode = "horizon";
  const labelsCount = chart.data.labels.length;
  const windowSize = Math.min(labelsCount, Math.max(forecastResult.forecast.length * 4, 160));
  chartWindowStart = Math.max(0, labelsCount - windowSize);
  renderForecast(forecastResult);
});

$("timelineSlider").addEventListener("input", (event) => {
  if (!forecastResult || !chart) return;
  const slider = event.currentTarget;
  if (chartViewMode === "horizon") {
    chartWindowStart = Number(slider.value);
    const windowSize = Math.min(chart.data.labels.length, Math.max(forecastResult.forecast.length * 4, 160));
    chart.options.scales.x.min = chartWindowStart;
    chart.options.scales.x.max = Math.min(chart.data.labels.length - 1, chartWindowStart + windowSize - 1);
    chart.update("none");
    $("timelineSliderHint").textContent = `Focused view · periods ${chartWindowStart + 1}–${Math.min(chart.data.labels.length, chartWindowStart + windowSize)} of ${chart.data.labels.length}`;
  } else if (chartViewMode === "scroll") {
    const maxScroll = $("chartScroll").scrollWidth - $("chartScroll").clientWidth;
    $("chartScroll").scrollLeft = maxScroll * (Number(slider.value) / 1000);
    $("timelineSliderHint").textContent = `Timeline position · ${Math.round(Number(slider.value) / 10)}%`;
  }
});

$("chartScroll").addEventListener("scroll", () => {
  if (chartViewMode !== "scroll" || !$("timelineSlider")) return;
  const maxScroll = $("chartScroll").scrollWidth - $("chartScroll").clientWidth;
  if (maxScroll > 0) {
    $("timelineSlider").value = String(Math.round($("chartScroll").scrollLeft / maxScroll * 1000));
  }
});

function updateTopConfigCards() {
  const horizon = $("horizon");
  const frequency = $("frequency");
  const target = $("targetColumn");
  if (horizon) $("topHorizonValue").innerHTML = `${escapeHtml(horizon.value || "--")}<small>periods</small>`;
  if (frequency) {
    const labels = { "5min":"5-minute intervals", "15min":"15-minute intervals", "1h":"Hourly intervals", "4h":"4-hour intervals", "D":"Daily intervals", "W":"Weekly intervals", "MS":"Monthly intervals" };
    $("topHorizonNote").textContent = labels[frequency.value] || `${frequency.value} frequency`;
  }
  if (target && target.value) {
    $("topTargetValue").textContent = target.value;
    $("topTargetNote").textContent = "Selected forecast metric";
  } else {
    $("topTargetValue").textContent = "Not selected";
    $("topTargetNote").textContent = "Choose a metric to forecast";
  }
}

function getEvaluationMetrics(data) {
  // The current forecast API does not return backtest scores. This supports
  // future API payloads without fabricating metrics in the browser.
  const source = data?.evaluation_metrics || data?.metrics || data?.evaluation || {};
  return {
    wape: source.wape ?? source.WAPE ?? null,
    mae: source.mae ?? source.MAE ?? null,
    mape: source.mape ?? source.MAPE ?? null
  };
}

function displayMetric(value, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(2)}${suffix}`;
}

function updateEvaluationCards(data) {
  const metrics = getEvaluationMetrics(data);
  const hasMetrics = Object.values(metrics).some(v => v !== null && v !== undefined);
  $("wapeValue").innerHTML = `${displayMetric(metrics.wape)}<small>%</small>`;
  $("maeValue").innerHTML = `${displayMetric(metrics.mae)}<small id="maeUnit">${escapeHtml(data.target || $("targetColumn").value || "units")}</small>`;
  $("mapeValue").innerHTML = `${displayMetric(metrics.mape)}<small>%</small>`;
  const evaluation = data?.evaluation_metrics || {};
  const evaluationNote = evaluation.observations
    ? `Holdout: ${Number(evaluation.observations).toLocaleString()} observations`
    : (evaluation.note || "Backtest unavailable");
  $("wapeNote").textContent = metrics.wape != null ? `Lower is better · ${evaluationNote}` : evaluationNote;
  $("maeNote").textContent = metrics.mae != null ? `Lower is better · ${evaluationNote}` : evaluationNote;
  $("mapeNote").textContent = metrics.mape != null ? `Lower is better · ${evaluationNote}` : evaluationNote;
}

$("horizon").addEventListener("change", updateTopConfigCards);
$("frequency").addEventListener("change", updateTopConfigCards);
$("targetColumn").addEventListener("change", updateTopConfigCards);
updateTopConfigCards();

checkApi();
