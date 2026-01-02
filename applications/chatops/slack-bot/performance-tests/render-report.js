#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function die(message) {
  console.error(message);
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) {
  die("Usage: node render-report.js <input.json> [output.html]");
}

if (!fs.existsSync(inputPath)) {
  die(`Input not found: ${inputPath}`);
}

let outputPath = process.argv[3];
if (!outputPath) {
  outputPath = inputPath.endsWith(".json")
    ? inputPath.slice(0, -5) + ".html"
    : inputPath + ".html";
}

// .metrics.json 파일 경로 생성 및 읽기
let metricsData = null;
if (inputPath.endsWith(".json") && !inputPath.includes(".metrics.json")) {
  const metricsPath = inputPath.slice(0, -5) + ".metrics.json";
  if (fs.existsSync(metricsPath)) {
    try {
      metricsData = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
      console.log(`✓ Loaded metrics from: ${metricsPath}`);
    } catch (err) {
      console.warn(`Warning: Failed to parse metrics: ${err.message}`);
    }
  }
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (err) {
  die(`Failed to parse JSON: ${err.message}`);
}

const aggregate = raw.aggregate || {};
const counters = aggregate.counters || {};
const summaries = aggregate.summaries || {};
const histograms = aggregate.histograms || {};
const intermediate = Array.isArray(raw.intermediate) ? raw.intermediate : [];

const responseSummary = summaries["http.response_time"] || {};
const sessionSummary = summaries["vusers.session_length"] || {};
const responseHistogram = histograms["http.response_time"] || {};

const toNumber = (value) => (Number.isFinite(value) ? value : 0);

const totalRequests = toNumber(counters["http.requests"]);
const totalResponses = toNumber(counters["http.responses"]);
const errorCount = toNumber(counters["errors.total"]);
const durationMs = toNumber(sessionSummary.max);
const avgRps = durationMs ? totalRequests / (durationMs / 1000) : 0;

const httpCodes = {};
const otherCodes = {};
Object.entries(counters).forEach(([key, value]) => {
  const match = key.match(/(?:^|\\.)codes\\.(\\d+)$/);
  if (!match) return;
  const code = match[1];
  if (key.startsWith("http.codes.")) {
    httpCodes[code] = (httpCodes[code] || 0) + toNumber(value);
  } else {
    otherCodes[code] = (otherCodes[code] || 0) + toNumber(value);
  }
});

const codesSource = Object.keys(httpCodes).length ? httpCodes : otherCodes;
const codes = Object.entries(codesSource)
  .map(([code, count]) => ({ code, count }))
  .sort((a, b) => Number(a.code) - Number(b.code));

const errorMap = {};
Object.entries(counters).forEach(([key, value]) => {
  const idx = key.lastIndexOf("errors.");
  if (idx === -1) return;
  const label = key.slice(idx + "errors.".length);
  if (label === "total") return;
  errorMap[label] = (errorMap[label] || 0) + toNumber(value);
});

const errors = Object.entries(errorMap)
  .map(([label, count]) => ({ label, count }))
  .sort((a, b) => b.count - a.count);

const summary = {
  requests: totalRequests,
  responses: totalResponses,
  errors: errorCount,
  errorRate: totalRequests ? (errorCount / totalRequests) * 100 : 0,
  durationMs,
  avgRps,
  min: toNumber(responseSummary.min),
  max: toNumber(responseSummary.max),
  mean: toNumber(responseSummary.mean),
  median: toNumber(responseSummary.median || responseSummary.p50),
  p95: toNumber(responseSummary.p95),
  p99: toNumber(responseSummary.p99),
  cloudwatch: metricsData ? metricsData.cloudwatch : null,
};

const vusers = {
  created: toNumber(counters["vusers.created"]),
  completed: toNumber(counters["vusers.completed"]),
  failed: toNumber(counters["vusers.failed"]),
  scenarios: Object.entries(counters)
    .filter(([key]) => key.startsWith("vusers.created_by_name."))
    .map(([key, value]) => ({
      name: key.replace("vusers.created_by_name.", ""),
      count: toNumber(value),
    }))
    .sort((a, b) => b.count - a.count),
};

summary.vusersCreated = vusers.created;
summary.vusersCompleted = vusers.completed;
summary.vusersFailed = vusers.failed;

const endpoints = Object.entries(summaries)
  .filter(([key]) => key.includes(".response_time.") && !key.startsWith("http."))
  .map(([key, stats]) => {
    const label = key.split(".response_time.")[1] || key;
    const histogram = histograms[key] || {};
    return {
      label,
      min: toNumber(stats.min),
      max: toNumber(stats.max),
      mean: toNumber(stats.mean),
      median: toNumber(stats.median || stats.p50),
      p95: toNumber(stats.p95 || histogram.p95),
      p99: toNumber(stats.p99 || histogram.p99),
      count: toNumber(stats.count),
    };
  })
  .sort((a, b) => b.p95 - a.p95);

const rawAggregate = {
  counters,
  summaries,
  histograms,
  rates: aggregate.rates || {},
  firstCounterAt: aggregate.firstCounterAt,
  lastCounterAt: aggregate.lastCounterAt,
  firstHistogramAt: aggregate.firstHistogramAt,
  lastHistogramAt: aggregate.lastHistogramAt,
  firstMetricAt: aggregate.firstMetricAt,
  lastMetricAt: aggregate.lastMetricAt,
  period: aggregate.period,
};

const series = intermediate
  .map((item, index) => {
    const stats = (item.summaries || {})["http.response_time"] || {};
    const rates = item.rates || {};
    const ts = item.period || item.firstMetricAt || index;
    return {
      ts,
      median: toNumber(stats.median || stats.p50),
      p95: toNumber(stats.p95),
      p99: toNumber(stats.p99),
      rps: toNumber(rates["http.request_rate"]),
    };
  })
  .filter((point) => point.ts !== undefined);

const percentileKeys = ["p50", "p75", "p90", "p95", "p99", "p999"];
const percentiles = percentileKeys
  .map((key) => ({
    label: key.toUpperCase(),
    value: toNumber(responseHistogram[key]),
  }))
  .filter((item) => item.value > 0);

const reportData = {
  meta: {
    source: path.basename(inputPath),
    generatedAt: new Date().toISOString(),
  },
  summary,
  series,
  percentiles,
  codes,
  errors,
  endpoints,
  scenarios: vusers.scenarios,
  rawAggregate,
};

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Artillery E2E Report</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f5fb;
        --card: #ffffff;
        --text: #1f2a44;
        --muted: #6b7280;
        --accent: #2856f7;
        --accent-2: #14b8a6;
        --accent-3: #f97316;
        --border: #e6e8f0;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: "Space Grotesk", "Segoe UI", Arial, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(40, 86, 247, 0.12), transparent 45%),
          radial-gradient(circle at 20% 40%, rgba(20, 184, 166, 0.12), transparent 50%),
          radial-gradient(circle at 80% 10%, rgba(249, 115, 22, 0.12), transparent 40%),
          var(--bg);
        color: var(--text);
      }
      header {
        padding: 36px 24px 16px;
        background: linear-gradient(120deg, rgba(40, 86, 247, 0.12), rgba(20, 184, 166, 0.12));
        border-bottom: 1px solid var(--border);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 32px;
        letter-spacing: -0.8px;
      }
      .meta {
        color: var(--muted);
        font-size: 13px;
      }
      .container {
        padding: 20px 24px 40px;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-bottom: 24px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 14px 30px rgba(31, 42, 68, 0.08);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 18px 36px rgba(31, 42, 68, 0.12);
      }
      .card .label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .card .value {
        font-size: 20px;
        font-weight: 600;
      }
      .card .value.small {
        font-size: 16px;
        font-weight: 500;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
      }
      .panel {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 16px;
        box-shadow: 0 12px 28px rgba(31, 42, 68, 0.06);
      }
      .panel h2 {
        margin: 0 0 12px;
        font-size: 16px;
      }
      .panel canvas {
        width: 100% !important;
        height: 240px !important;
      }
      .panel.chart-panel {
        min-height: 300px;
      }
      .panel.full-width {
        grid-column: 1 / -1;
      }
      .chart-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        margin-bottom: 8px;
        font-size: 13px;
        color: var(--muted);
      }
      .chart-controls label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .table th,
      .table td {
        padding: 8px 6px;
        border-bottom: 1px solid var(--border);
        text-align: left;
      }
      .table th {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .table th[data-sort] {
        cursor: pointer;
        user-select: none;
      }
      .table th[data-sort][data-dir="asc"]::after {
        content: " ^";
      }
      .table th[data-sort][data-dir="desc"]::after {
        content: " v";
      }
      .empty {
        color: var(--muted);
        font-size: 13px;
        margin: 8px 0 0;
      }
      details {
        margin-top: 10px;
      }
      details > summary {
        cursor: pointer;
        font-weight: 600;
      }
      pre {
        background: #f3f5fb;
        border-radius: 8px;
        padding: 12px;
        overflow: auto;
        font-size: 12px;
        line-height: 1.4;
        font-family: "IBM Plex Mono", "Courier New", monospace;
      }
      .note {
        margin-top: 18px;
        color: var(--muted);
        font-size: 12px;
      }
      @media (max-width: 640px) {
        header {
          padding: 24px 16px 4px;
        }
        .container {
          padding: 12px 16px 24px;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Artillery E2E Report</h1>
      <div class="meta" id="meta"></div>
    </header>
    <div class="container">
      <section class="cards">
        <div class="card">
          <div class="label">Requests</div>
          <div class="value" id="requests"></div>
        </div>
        <div class="card">
          <div class="label">Responses</div>
          <div class="value" id="responses"></div>
        </div>
        <div class="card">
          <div class="label">VUsers Created</div>
          <div class="value" id="vusersCreated"></div>
        </div>
        <div class="card">
          <div class="label">VUsers Completed</div>
          <div class="value" id="vusersCompleted"></div>
        </div>
        <div class="card">
          <div class="label">VUsers Failed</div>
          <div class="value" id="vusersFailed"></div>
        </div>
        <div class="card">
          <div class="label">Errors</div>
          <div class="value" id="errors"></div>
          <div class="value small" id="errorRate"></div>
        </div>
        <div class="card">
          <div class="label">Avg RPS</div>
          <div class="value" id="avgRps"></div>
        </div>
        <div class="card">
          <div class="label">Duration</div>
          <div class="value" id="duration"></div>
        </div>
        <div class="card">
          <div class="label">P95 Latency</div>
          <div class="value" id="p95"></div>
        </div>
        <div class="card">
          <div class="label">P99 Latency</div>
          <div class="value" id="p99"></div>
        </div>
      </section>

      <section class="grid">
        <div class="panel chart-panel">
          <h2>Response Time (ms)</h2>
          <div class="chart-controls" id="latencyControls">
            <label><input type="checkbox" data-series="median" checked /> Median</label>
            <label><input type="checkbox" data-series="p95" checked /> P95</label>
            <label><input type="checkbox" data-series="p99" checked /> P99</label>
          </div>
          <canvas id="latencyChart" height="240"></canvas>
        </div>
        <div class="panel chart-panel">
          <h2>Request Rate (req/s)</h2>
          <canvas id="rpsChart" height="240"></canvas>
        </div>
        <div class="panel chart-panel">
          <h2>Latency Percentiles (ms)</h2>
          <canvas id="percentileChart" height="240"></canvas>
        </div>
        <div class="panel chart-panel">
          <h2>Status Codes</h2>
          <div class="empty" id="codesEmpty">No status codes recorded.</div>
          <canvas id="codeChart" height="240"></canvas>
        </div>
        <div class="panel chart-panel">
          <h2>Error Types</h2>
          <div class="empty" id="errorsEmpty">No errors recorded.</div>
          <canvas id="errorChart" height="240"></canvas>
        </div>
      </section>

      <section class="grid">
        <div class="panel">
          <h2>Endpoint Latency (ms)</h2>
          <table class="table" id="endpointTable">
            <thead>
              <tr>
                <th data-sort="label">Endpoint</th>
                <th data-sort="median">Median</th>
                <th data-sort="p95">P95</th>
                <th data-sort="p99">P99</th>
                <th data-sort="count">Count</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Scenario VUsers</h2>
          <table class="table" id="scenarioTable">
            <thead>
              <tr>
                <th data-sort="name">Scenario</th>
                <th data-sort="count">Created</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <!-- CloudWatch Metrics Section -->
      <section class="panel full-width" id="cloudwatchSection" style="display: none;">
        <h2>CloudWatch & E2E Metrics</h2>
        <div class="cards">
          <div class="card">
            <div class="card-title">Router Lambda (API Gateway → Router)</div>
            <div class="card-stat" id="routerInvocations">-</div>
            <div class="card-label">Invocations</div>
            <div style="margin-top: 12px; font-size: 12px; color: var(--muted);">
              <div>Avg: <span id="routerAvg">-</span> ms</div>
              <div>P95: <span id="routerP95">-</span> ms</div>
              <div>P99: <span id="routerP99">-</span> ms</div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Worker Lambda (EventBridge → SQS → Worker)</div>
            <div class="card-stat" id="workerInvocations">-</div>
            <div class="card-label">Invocations</div>
            <div style="margin-top: 12px; font-size: 12px; color: var(--muted);">
              <div>Avg: <span id="workerAvg">-</span> ms</div>
              <div>P95: <span id="workerP95">-</span> ms</div>
              <div>P99: <span id="workerP99">-</span> ms</div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">End-to-End (API → Worker Completion)</div>
            <div class="card-stat" id="e2eInvocations">-</div>
            <div class="card-label">Invocations</div>
            <div style="margin-top: 12px; font-size: 12px; color: var(--muted);">
              <div>Avg: <span id="e2eAvg">-</span> ms</div>
              <div>P95: <span id="e2eP95">-</span> ms</div>
              <div>P99: <span id="e2eP99">-</span> ms</div>
            </div>
          </div>
        </div>
        <div style="margin-top: 16px; padding: 12px; background: var(--bg); border-radius: 4px; font-size: 12px;">
          <div>Errors - Router: <span id="routerErrors">-</span>, Worker: <span id="workerErrors">-</span></div>
        </div>
      </section>

      <section class="panel full-width">
        <h2>Raw Aggregate Metrics</h2>
        <details>
          <summary>Counters</summary>
          <pre id="rawCounters"></pre>
        </details>
        <details>
          <summary>Summaries</summary>
          <pre id="rawSummaries"></pre>
        </details>
        <details>
          <summary>Histograms</summary>
          <pre id="rawHistograms"></pre>
        </details>
        <details>
          <summary>Rates</summary>
          <pre id="rawRates"></pre>
        </details>
        <details>
          <summary>Timing Metadata</summary>
          <pre id="rawTiming"></pre>
        </details>
      </section>
      <div class="note">
        Charts are rendered in-browser using Chart.js (CDN).
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <script>
      const data = ${JSON.stringify(reportData)};
      const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
      const msFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
      const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

      const metaEl = document.getElementById("meta");
      metaEl.textContent = "Source: " + data.meta.source + " | Generated: " + data.meta.generatedAt;

      const formatDuration = (ms) => {
        if (!Number.isFinite(ms) || ms <= 0) return "-";
        const seconds = ms / 1000;
        if (seconds < 60) {
          return msFmt.format(seconds) + " s";
        }
        const minutes = Math.floor(seconds / 60);
        const remaining = seconds % 60;
        return minutes + "m " + msFmt.format(remaining) + "s";
      };

      const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      };

      setText("requests", fmt.format(data.summary.requests));
      setText("responses", fmt.format(data.summary.responses));
      setText("vusersCreated", fmt.format(data.summary.vusersCreated));
      setText("vusersCompleted", fmt.format(data.summary.vusersCompleted));
      setText("vusersFailed", fmt.format(data.summary.vusersFailed));
      setText("errors", fmt.format(data.summary.errors));
      setText("errorRate", "Rate: " + fmt.format(data.summary.errorRate) + "%");
      setText("avgRps", fmt.format(data.summary.avgRps));
      setText("duration", formatDuration(data.summary.durationMs));
      setText("p95", msFmt.format(data.summary.p95) + " ms");
      setText("p99", msFmt.format(data.summary.p99) + " ms");

      // CloudWatch Metrics 표시
      if (data.summary.cloudwatch && Object.keys(data.summary.cloudwatch).length > 0) {
        const cwSection = document.getElementById("cloudwatchSection");
        if (cwSection) cwSection.style.display = "block";

        const cw = data.summary.cloudwatch;

        // Router Lambda
        if (cw.router) {
          setText("routerInvocations", fmt.format(cw.router.invocations || 0));
          setText("routerAvg", msFmt.format(parseFloat(cw.router.avg_ms) || 0));
          setText("routerP95", msFmt.format(parseFloat(cw.router.p95_ms) || 0));
          setText("routerP99", msFmt.format(parseFloat(cw.router.p99_ms) || 0));
        }

        // Worker Lambda
        if (cw.worker) {
          setText("workerInvocations", fmt.format(cw.worker.invocations || 0));
          setText("workerAvg", msFmt.format(parseFloat(cw.worker.avg_ms) || 0));
          setText("workerP95", msFmt.format(parseFloat(cw.worker.p95_ms) || 0));
          setText("workerP99", msFmt.format(parseFloat(cw.worker.p99_ms) || 0));
        }

        // E2E Metrics
        if (cw.e2e && Object.keys(cw.e2e).length > 0) {
          setText("e2eInvocations", fmt.format(cw.e2e.invocations || 0));
          setText("e2eAvg", msFmt.format(parseFloat(cw.e2e.avg_ms) || 0));
          setText("e2eP95", msFmt.format(parseFloat(cw.e2e.p95_ms) || 0));
          setText("e2eP99", msFmt.format(parseFloat(cw.e2e.p99_ms) || 0));
        }

        // Errors
        setText("routerErrors", fmt.format(cw.errors?.router || 0));
        setText("workerErrors", fmt.format(cw.errors?.worker || 0));

        console.log("✓ CloudWatch metrics rendered");
      }

      const seriesLabels = data.series.map((point) => {
        const ts = Number(point.ts);
        if (!Number.isFinite(ts)) return "";
        return new Date(ts).toLocaleTimeString();
      });

      const latencyChart = new Chart(document.getElementById("latencyChart"), {
        type: "line",
        data: {
          labels: seriesLabels,
          datasets: [
            {
              label: "Median",
              data: data.series.map((point) => point.median),
              borderColor: "#2856f7",
              backgroundColor: "rgba(40, 86, 247, 0.2)",
              tension: 0.3,
            },
            {
              label: "P95",
              data: data.series.map((point) => point.p95),
              borderColor: "#14b8a6",
              backgroundColor: "rgba(20, 184, 166, 0.2)",
              tension: 0.3,
            },
            {
              label: "P99",
              data: data.series.map((point) => point.p99),
              borderColor: "#f97316",
              backgroundColor: "rgba(249, 115, 22, 0.2)",
              tension: 0.3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
          },
          scales: {
            y: { title: { display: true, text: "ms" } },
          },
        },
      });

      const latencySeriesIndex = { median: 0, p95: 1, p99: 2 };
      document.querySelectorAll("#latencyControls input").forEach((checkbox) => {
        checkbox.addEventListener("change", (event) => {
          const key = event.target.dataset.series;
          const index = latencySeriesIndex[key];
          if (index === undefined) return;
          latencyChart.setDatasetVisibility(index, event.target.checked);
          latencyChart.update();
        });
      });

      const rpsChart = new Chart(document.getElementById("rpsChart"), {
        type: "line",
        data: {
          labels: seriesLabels,
          datasets: [
            {
              label: "RPS",
              data: data.series.map((point) => point.rps),
              borderColor: "#f97316",
              backgroundColor: "rgba(249, 115, 22, 0.2)",
              tension: 0.25,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top" },
          },
          scales: {
            y: { title: { display: true, text: "req/s" } },
          },
        },
      });

      const percentileLabels = data.percentiles.map((item) => item.label);
      const percentileValues = data.percentiles.map((item) => item.value);

      const percentileChart = new Chart(document.getElementById("percentileChart"), {
        type: "bar",
        data: {
          labels: percentileLabels,
          datasets: [
            {
              label: "Latency",
              data: percentileValues,
              backgroundColor: "rgba(40, 86, 247, 0.5)",
              borderColor: "#2856f7",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            y: { title: { display: true, text: "ms" } },
          },
        },
      });

      const codesEmpty = document.getElementById("codesEmpty");
      const codeChartEl = document.getElementById("codeChart");
      if (data.codes && data.codes.length && codeChartEl) {
        if (codesEmpty) codesEmpty.style.display = "none";
        new Chart(codeChartEl, {
          type: "bar",
          data: {
            labels: data.codes.map((item) => item.code),
            datasets: [
              {
                label: "Count",
                data: data.codes.map((item) => item.count),
                backgroundColor: "rgba(59, 130, 246, 0.5)",
                borderColor: "#3b82f6",
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
            },
            scales: {
              y: { title: { display: true, text: "Count" } },
            },
          },
        });
      } else if (codeChartEl) {
        codeChartEl.style.display = "none";
      }

      const errorsEmpty = document.getElementById("errorsEmpty");
      const errorChartEl = document.getElementById("errorChart");
      if (data.errors && data.errors.length && errorChartEl) {
        if (errorsEmpty) errorsEmpty.style.display = "none";
        new Chart(errorChartEl, {
          type: "bar",
          data: {
            labels: data.errors.map((item) => item.label),
            datasets: [
              {
                label: "Count",
                data: data.errors.map((item) => item.count),
                backgroundColor: "rgba(239, 68, 68, 0.45)",
                borderColor: "#ef4444",
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: "y",
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: { title: { display: true, text: "Count" } },
            },
          },
        });
      } else if (errorChartEl) {
        errorChartEl.style.display = "none";
      }

      const endpointTable = document.getElementById("endpointTable");
      const endpointBody = endpointTable ? endpointTable.querySelector("tbody") : null;
      const endpointHeaders = endpointTable
        ? endpointTable.querySelectorAll("th[data-sort]")
        : [];
      let endpointSort = { key: "p95", dir: "desc" };

      const sortItems = (items, key, dir) => {
        const sorted = [...items].sort((a, b) => {
          const av = a[key];
          const bv = b[key];
          if (typeof av === "string" || typeof bv === "string") {
            return String(av).localeCompare(String(bv));
          }
          return Number(av) - Number(bv);
        });
        return dir === "desc" ? sorted.reverse() : sorted;
      };

      const renderEndpointTable = () => {
        if (!endpointBody) return;
        endpointBody.innerHTML = "";
        if (!data.endpoints || data.endpoints.length === 0) {
          const row = document.createElement("tr");
          const cell = document.createElement("td");
          cell.textContent = "No endpoint metrics found.";
          cell.colSpan = 5;
          row.appendChild(cell);
          endpointBody.appendChild(row);
          return;
        }

        const sorted = sortItems(data.endpoints, endpointSort.key, endpointSort.dir);
        sorted.forEach((item) => {
          const row = document.createElement("tr");
          const cells = [
            item.label,
            msFmt.format(item.median),
            msFmt.format(item.p95),
            msFmt.format(item.p99),
            intFmt.format(item.count),
          ];
          cells.forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
          });
          endpointBody.appendChild(row);
        });
      };

      if (endpointHeaders.length) {
        endpointHeaders.forEach((header) => {
          if (header.dataset.sort === endpointSort.key) {
            header.dataset.dir = endpointSort.dir;
          }
          header.addEventListener("click", () => {
            const key = header.dataset.sort;
            if (!key) return;
            const dir = endpointSort.key === key && endpointSort.dir === "desc" ? "asc" : "desc";
            endpointSort = { key, dir };
            endpointHeaders.forEach((th) => {
              if (th.dataset.sort === key) {
                th.dataset.dir = dir;
              } else {
                delete th.dataset.dir;
              }
            });
            renderEndpointTable();
          });
        });
      }
      renderEndpointTable();

      const scenarioTable = document.getElementById("scenarioTable");
      const scenarioBody = scenarioTable ? scenarioTable.querySelector("tbody") : null;
      const scenarioHeaders = scenarioTable
        ? scenarioTable.querySelectorAll("th[data-sort]")
        : [];
      let scenarioSort = { key: "count", dir: "desc" };

      const renderScenarioTable = () => {
        if (!scenarioBody) return;
        scenarioBody.innerHTML = "";
        if (!data.scenarios || data.scenarios.length === 0) {
          const row = document.createElement("tr");
          const cell = document.createElement("td");
          cell.textContent = "No scenario data found.";
          cell.colSpan = 2;
          row.appendChild(cell);
          scenarioBody.appendChild(row);
          return;
        }

        const sorted = sortItems(data.scenarios, scenarioSort.key, scenarioSort.dir);
        sorted.forEach((item) => {
          const row = document.createElement("tr");
          const nameCell = document.createElement("td");
          nameCell.textContent = item.name;
          const countCell = document.createElement("td");
          countCell.textContent = intFmt.format(item.count);
          row.appendChild(nameCell);
          row.appendChild(countCell);
          scenarioBody.appendChild(row);
        });
      };

      if (scenarioHeaders.length) {
        scenarioHeaders.forEach((header) => {
          if (header.dataset.sort === scenarioSort.key) {
            header.dataset.dir = scenarioSort.dir;
          }
          header.addEventListener("click", () => {
            const key = header.dataset.sort;
            if (!key) return;
            const dir = scenarioSort.key === key && scenarioSort.dir === "desc" ? "asc" : "desc";
            scenarioSort = { key, dir };
            scenarioHeaders.forEach((th) => {
              if (th.dataset.sort === key) {
                th.dataset.dir = dir;
              } else {
                delete th.dataset.dir;
              }
            });
            renderScenarioTable();
          });
        });
      }
      renderScenarioTable();

      const setPre = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = JSON.stringify(value, null, 2);
      };

      setPre("rawCounters", data.rawAggregate.counters || {});
      setPre("rawSummaries", data.rawAggregate.summaries || {});
      setPre("rawHistograms", data.rawAggregate.histograms || {});
      setPre("rawRates", data.rawAggregate.rates || {});
      setPre("rawTiming", {
        firstCounterAt: data.rawAggregate.firstCounterAt,
        lastCounterAt: data.rawAggregate.lastCounterAt,
        firstHistogramAt: data.rawAggregate.firstHistogramAt,
        lastHistogramAt: data.rawAggregate.lastHistogramAt,
        firstMetricAt: data.rawAggregate.firstMetricAt,
        lastMetricAt: data.rawAggregate.lastMetricAt,
        period: data.rawAggregate.period,
      });
    </script>
  </body>
</html>
`;

fs.writeFileSync(outputPath, html, "utf8");
console.log(`Report written to ${outputPath}`);
