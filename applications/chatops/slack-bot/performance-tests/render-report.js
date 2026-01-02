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
        letter-spacing: -0.5px;
      }
      h2 {
        font-weight: 600;
        letter-spacing: -0.3px;
      }
      .meta {
        color: var(--muted);
        font-size: 13px;
      }
      .toc {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px 20px;
        margin-bottom: 24px;
        box-shadow: 0 8px 20px rgba(31, 42, 68, 0.06);
      }
      .toc h3 {
        margin: 0 0 12px;
        font-size: 13px;
        text-transform: uppercase;
        font-weight: 600;
        color: var(--muted);
      }
      .toc ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .toc li {
        margin: 6px 0;
      }
      .toc a {
        color: var(--accent);
        text-decoration: none;
        font-size: 13px;
        transition: color 0.2s ease;
      }
      .toc a:hover {
        color: var(--accent-2);
        text-decoration: underline;
      }
      .container {
        padding: 20px 24px 40px;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
        margin-bottom: 24px;
      }
      @media (max-width: 768px) {
        .cards {
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        }
      }
      @media (max-width: 480px) {
        .cards {
          grid-template-columns: 1fr;
        }
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
        font-size: 11px;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 8px;
        font-weight: 500;
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
        grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
        gap: 16px;
      }
      .grid.chart-grid {
        grid-template-columns: repeat(4, 1fr);
      }
      @media (max-width: 1200px) {
        .grid {
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        }
        .grid.chart-grid {
          grid-template-columns: repeat(4, 1fr);
        }
      }
      @media (max-width: 900px) {
        .grid.chart-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      @media (max-width: 768px) {
        .grid {
          grid-template-columns: 1fr;
        }
        .grid.chart-grid {
          grid-template-columns: 1fr;
        }
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
        color: var(--muted);
        font-weight: 600;
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
      <div class="toc">
        <h3>📋 Table of Contents</h3>
        <ul>
          <li><a href="#section-1">1. Test Configuration</a></li>
          <li><a href="#section-2">2. Summary</a></li>
          <li><a href="#section-3">3. Client-Side Metrics</a></li>
          <li><a href="#section-4">4. Server-Side Metrics</a></li>
          <li><a href="#section-5">5. Raw Data (Evidence)</a></li>
        </ul>
      </div>

      <h2 style="margin: 0 0 12px; font-size: 20px;" id="section-1">1. Test Configuration</h2>

      <section class="panel" style="margin-bottom: 24px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
          <div>
            <div style="color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 4px; font-weight: 600;">Test Duration</div>
            <div style="font-weight: 600;" id="testDuration"></div>
          </div>
          <div>
            <div style="color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 4px; font-weight: 600;">Total VUsers</div>
            <div style="font-weight: 600;" id="testVUsers"></div>
          </div>
          <div>
            <div style="color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 4px; font-weight: 600;">Total Requests</div>
            <div style="font-weight: 600;" id="testRequests"></div>
          </div>
          <div>
            <div style="color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 4px; font-weight: 600;">Avg Request Rate</div>
            <div style="font-weight: 600;" id="testAvgRps"></div>
          </div>
        </div>
      </section>

      <h2 style="margin: 24px 0 12px; font-size: 20px;" id="section-2">2. Summary</h2>
      <section class="cards" style="margin-bottom: 24px;">
        <div class="card">
          <div class="label">Total Requests</div>
          <div class="value" id="requests"></div>
        </div>
        <div class="card">
          <div class="label">Successful Responses</div>
          <div class="value" id="responses"></div>
        </div>
        <div class="card">
          <div class="label">VUsers Completed</div>
          <div class="value" id="vusersCompleted"></div>
          <div class="value small" style="color: var(--muted); margin-top: 4px;">
            <span id="vusersFailed">0</span> failed
          </div>
        </div>
        <div class="card">
          <div class="label">Error Rate</div>
          <div class="value" id="errors"></div>
          <div class="value small" id="errorRate"></div>
        </div>
      </section>

      <h2 style="margin: 24px 0 12px; font-size: 20px;" id="section-3">3. Client-Side Metrics</h2>
      <div style="font-size: 13px; color: var(--muted); margin-bottom: 16px; padding: 12px; background: rgba(40, 86, 247, 0.05); border-left: 3px solid var(--accent); border-radius: 4px;">
        <strong>Measurement Scope:</strong> HTTP request sent from client → Response received by client<br/>
        <strong>Includes:</strong> Network latency + API Gateway processing + Lambda cold start + Execution time
      </div>

      <section class="cards" style="margin-bottom: 16px;">
        <div class="card" style="border: 2px solid var(--accent);">
          <div class="label">Median Latency</div>
          <div class="value" id="clientMedian"></div>
        </div>
        <div class="card" style="border: 2px solid var(--accent);">
          <div class="label">P95 Latency</div>
          <div class="value" id="clientP95"></div>
        </div>
        <div class="card" style="border: 2px solid var(--accent);">
          <div class="label">P99 Latency</div>
          <div class="value" id="clientP99"></div>
        </div>
        <div class="card" style="border: 2px solid var(--accent);">
          <div class="label">Max Latency</div>
          <div class="value" id="clientMax"></div>
        </div>
      </section>

      <section class="grid chart-grid">
        <div class="panel chart-panel" style="grid-column: span 2;">
          <h2>Client Response Time (HTTP Round-Trip)</h2>
          <div class="chart-controls" id="latencyControls">
            <label><input type="checkbox" data-series="median" checked /> Median</label>
            <label><input type="checkbox" data-series="p95" checked /> P95</label>
            <label><input type="checkbox" data-series="p99" checked /> P99</label>
          </div>
          <canvas id="latencyChart" height="240"></canvas>
        </div>
        <div class="panel chart-panel" style="grid-column: span 2;">
          <h2>Request Rate (req/s)</h2>
          <canvas id="rpsChart" height="240"></canvas>
        </div>
        <div class="panel chart-panel" style="grid-column: span 2;">
          <h2>Latency Percentiles (ms)</h2>
          <canvas id="percentileChart" height="240"></canvas>
        </div>
        <div class="panel chart-panel" style="grid-column: span 1;">
          <h2>Status Codes</h2>
          <div class="empty" id="codesEmpty">No status codes recorded.</div>
          <canvas id="codeChart" height="240"></canvas>
        </div>
        <div class="panel chart-panel" style="grid-column: span 1;">
          <h2>Error Types</h2>
          <div class="empty" id="errorsEmpty">No errors recorded.</div>
          <canvas id="errorChart" height="240"></canvas>
        </div>
      </section>

      <section class="grid" style="margin-top: 32px;">
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
      <section id="cloudwatchSection" style="display: none; margin-top: 32px;">
        <h2 style="margin: 24px 0 12px; font-size: 20px;" id="section-4">4. Server-Side Metrics</h2>
        <div style="font-size: 13px; color: var(--muted); margin-bottom: 16px; padding: 12px; background: rgba(249, 115, 22, 0.05); border-left: 3px solid var(--accent-3); border-radius: 4px;">
          <strong>Measurement Scope:</strong> Lambda receives request → Processes through queue → Executes worker → Sends response<br/>
          <strong>Includes:</strong> SQS queue wait time + Router Lambda execution + Worker Lambda execution + Response delivery<br/>
          <strong>Note:</strong> This represents internal system processing time, independent of client network latency
        </div>

        <!-- E2E Summary Cards (Highlighted) -->
        <div class="cards" style="margin-bottom: 16px;">
          <div class="card" style="background: linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(249, 115, 22, 0.05)); border: 2px solid var(--accent-3);">
            <div class="label" style="color: var(--accent-3); font-weight: 600;">Server Requests Processed</div>
            <div class="value" id="e2eInvocations">-</div>
            <div class="value small" style="color: var(--muted); margin-top: 8px;">
              <div>Total processed</div>
            </div>
          </div>
          <div class="card" style="background: linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(249, 115, 22, 0.05)); border: 2px solid var(--accent-3);">
            <div class="label" style="color: var(--accent-3); font-weight: 600;">Server Avg Processing Time</div>
            <div class="value" id="e2eAvg">-</div>
            <div class="value small" style="color: var(--muted); margin-top: 8px;">
              <div>P50: <span id="e2eP50">-</span></div>
            </div>
          </div>
          <div class="card" style="background: linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(249, 115, 22, 0.05)); border: 2px solid var(--accent-3);">
            <div class="label" style="color: var(--accent-3); font-weight: 600;">Server P95 Processing Time</div>
            <div class="value" id="e2eP95">-</div>
            <div class="value small" style="color: var(--muted); margin-top: 8px;">
              <div>95th percentile</div>
            </div>
          </div>
          <div class="card" style="background: linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(249, 115, 22, 0.05)); border: 2px solid var(--accent-3);">
            <div class="label" style="color: var(--accent-3); font-weight: 600;">Server P99 Processing Time</div>
            <div class="value" id="e2eP99">-</div>
            <div class="value small" style="color: var(--muted); margin-top: 8px;">
              <div>99th percentile</div>
            </div>
          </div>
        </div>

        <!-- E2E Breakdown Cards -->
        <h3 style="margin: 20px 0 8px; font-size: 13px; text-transform: uppercase; color: var(--muted); font-weight: 600;">Processing Time Breakdown</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;">
          <div class="card">
            <div class="label">Queue Wait Time</div>
            <div class="value" id="queueWaitAvg">-</div>
            <div class="value small" style="color: var(--muted);">Average</div>
          </div>
          <div class="card">
            <div class="label">Sync Response</div>
            <div class="value" id="syncResponseAvg">-</div>
            <div class="value small" style="color: var(--muted);">Average</div>
          </div>
          <div class="card">
            <div class="label">Async Response</div>
            <div class="value" id="asyncResponseAvg">-</div>
            <div class="value small" style="color: var(--muted);">Average</div>
          </div>
        </div>

        <!-- Service Level Cards -->
        <h3 style="margin: 20px 0 8px; font-size: 13px; text-transform: uppercase; color: var(--muted); font-weight: 600;">Service Level Metrics</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
          <div class="card">
            <div class="label">Router Invocations</div>
            <div class="value" id="routerInvocations">-</div>
            <div class="value small" style="color: var(--muted); margin-top: 8px;">
              <div>Avg: <span id="routerAvg">-</span> ms</div>
            </div>
            <!-- Success message -->
            <div id="routerSuccess" style="display: none; margin-top: 8px; padding: 6px 8px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 4px;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #22c55e;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <span>Matches total requests</span>
              </div>
            </div>
            <!-- Warning message -->
            <div id="routerWarning" style="display: none; margin-top: 8px; padding: 6px 8px; background: rgba(255, 165, 0, 0.1); border: 1px solid rgba(255, 165, 0, 0.3); border-radius: 4px;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #ff9800;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span id="routerWarningText"></span>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="label">Worker Invocations</div>
            <div class="value" id="workerInvocations">-</div>
            <div class="value small" style="color: var(--muted); margin-top: 8px;">
              <div>Avg: <span id="workerAvg">-</span> ms</div>
            </div>
            <!-- Success message -->
            <div id="workerSuccess" style="display: none; margin-top: 8px; padding: 6px 8px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 4px;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #22c55e;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <span>Matches total requests</span>
              </div>
            </div>
            <!-- Warning message -->
            <div id="workerWarning" style="display: none; margin-top: 8px; padding: 6px 8px; background: rgba(255, 165, 0, 0.1); border: 1px solid rgba(255, 165, 0, 0.3); border-radius: 4px;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #ff9800;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span id="workerWarningText"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Charts Grid -->
        <div class="grid chart-grid" style="margin-top: 16px;">
          <div class="panel chart-panel" style="grid-column: span 2;">
            <h2>Service Latency Distribution</h2>
            <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">
              Note: Percentiles are calculated independently per service
            </div>
            <canvas id="latencyComparisonChart" height="240"></canvas>
          </div>
          <div class="panel chart-panel" style="grid-column: span 2;">
            <h2>Component Latency Comparison</h2>
            <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">
              Comparison of Router, Worker, and Server E2E latencies
            </div>
            <canvas id="serviceComparisonChart" height="240"></canvas>
          </div>
          <div class="panel chart-panel" style="grid-column: span 2;">
            <h2>Server Processing Timeline</h2>
            <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">
              Average time breakdown per request (stacked)
            </div>
            <canvas id="e2eTimelineChart" height="240"></canvas>
          </div>
          <div class="panel" style="grid-column: span 2;">
            <h2>Processing Component Details (ms)</h2>
            <table class="table" style="margin-top: 8px;">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Average (ms)</th>
                  <th>Percentage</th>
                </tr>
              </thead>
              <tbody id="e2eBreakdownTable"></tbody>
            </table>
          </div>
        </div>

        <div class="panel" style="margin-top: 16px;">
          <h2>Error Summary</h2>
          <div style="padding: 8px 0; font-size: 13px;">
            <div style="display: flex; gap: 24px;">
              <div>Router Errors: <strong id="routerErrors">-</strong></div>
              <div>Worker Errors: <strong id="workerErrors">-</strong></div>
            </div>
          </div>
        </div>
      </section>

      <h2 style="margin: 24px 0 12px; font-size: 20px;" id="section-5">5. Raw Data (Evidence)</h2>
      <section class="panel full-width">
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

      // Test Configuration
      setText("testDuration", formatDuration(data.summary.durationMs));
      setText("testVUsers", fmt.format(data.summary.vusersCreated));
      setText("testRequests", fmt.format(data.summary.requests));
      setText("testAvgRps", fmt.format(data.summary.avgRps) + " req/s");

      // Summary
      setText("requests", fmt.format(data.summary.requests));
      setText("responses", fmt.format(data.summary.responses));
      setText("vusersCompleted", fmt.format(data.summary.vusersCompleted));
      setText("vusersFailed", fmt.format(data.summary.vusersFailed));
      setText("errors", fmt.format(data.summary.errors));
      setText("errorRate", fmt.format(data.summary.errorRate) + "%");

      // Client-Side Metrics
      setText("clientMedian", msFmt.format(data.summary.median) + " ms");
      setText("clientP95", msFmt.format(data.summary.p95) + " ms");
      setText("clientP99", msFmt.format(data.summary.p99) + " ms");
      setText("clientMax", msFmt.format(data.summary.max) + " ms");

      // CloudWatch Metrics 표시
      if (data.summary.cloudwatch && Object.keys(data.summary.cloudwatch).length > 0) {
        const cwSection = document.getElementById("cloudwatchSection");
        if (cwSection) cwSection.style.display = "block";

        const cw = data.summary.cloudwatch;
        const totalRequests = data.summary.requests || 0;

        // Router Lambda
        if (cw.router) {
          const routerInvocations = parseInt(cw.router.invocations) || 0;
          setText("routerInvocations", fmt.format(routerInvocations));
          setText("routerAvg", msFmt.format(parseFloat(cw.router.avg_ms) || 0));
          
          // 성공/경고 표시
          if (totalRequests > 0) {
            const successEl = document.getElementById("routerSuccess");
            const warningEl = document.getElementById("routerWarning");
            const warningText = document.getElementById("routerWarningText");
            
            if (routerInvocations === totalRequests) {
              // 일치: 성공 메시지 표시
              if (successEl) successEl.style.display = "block";
            } else if (routerInvocations < totalRequests) {
              // 불일치: 경고 표시
              const diff = totalRequests - routerInvocations;
              const lossRate = ((diff / totalRequests) * 100).toFixed(1);
              if (warningEl && warningText) {
                warningEl.style.display = "block";
                warningText.textContent = diff + " requests lost (" + lossRate + "%)";
              }
            }
          }
        }

        // Worker Lambda
        if (cw.worker) {
          const workerInvocations = parseInt(cw.worker.invocations) || 0;
          setText("workerInvocations", fmt.format(workerInvocations));
          setText("workerAvg", msFmt.format(parseFloat(cw.worker.avg_ms) || 0));
          
          // 성공/경고 표시
          if (totalRequests > 0) {
            const successEl = document.getElementById("workerSuccess");
            const warningEl = document.getElementById("workerWarning");
            const warningText = document.getElementById("workerWarningText");
            
            if (workerInvocations === totalRequests) {
              // 일치: 성공 메시지 표시
              if (successEl) successEl.style.display = "block";
            } else if (workerInvocations < totalRequests) {
              // 불일치: 경고 표시
              const diff = totalRequests - workerInvocations;
              const lossRate = ((diff / totalRequests) * 100).toFixed(1);
              if (warningEl && warningText) {
                warningEl.style.display = "block";
                warningText.textContent = diff + " requests lost (" + lossRate + "%)";
              }
            }
          }
        }

        // E2E Metrics
        if (cw.e2e && Object.keys(cw.e2e).length > 0) {
          setText("e2eInvocations", fmt.format(cw.e2e.requests || 0));
          setText("e2eAvg", msFmt.format(parseFloat(cw.e2e.avg_e2e_ms) || 0) + " ms");
          setText("e2eP50", msFmt.format(parseFloat(cw.e2e.p50_e2e_ms) || 0) + " ms");
          setText("e2eP95", msFmt.format(parseFloat(cw.e2e.p95_e2e_ms) || 0) + " ms");
          setText("e2eP99", msFmt.format(parseFloat(cw.e2e.p99_e2e_ms) || 0) + " ms");
          setText("queueWaitAvg", msFmt.format(parseFloat(cw.e2e.avg_queue_wait_ms) || 0) + " ms");
          setText("syncResponseAvg", msFmt.format(parseFloat(cw.e2e.avg_sync_response_ms) || 0) + " ms");
          setText("asyncResponseAvg", msFmt.format(parseFloat(cw.e2e.avg_async_response_ms) || 0) + " ms");
        }

        // Errors
        setText("routerErrors", fmt.format(cw.errors?.router || 0));
        setText("workerErrors", fmt.format(cw.errors?.worker || 0));

        // 일관된 색상 팔레트 정의
        const colors = {
          router: { border: '#2856f7', bg: 'rgba(40, 86, 247, 0.2)' },
          worker: { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.2)' },
          e2e: { border: '#f97316', bg: 'rgba(249, 115, 22, 0.2)' },
          queue: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)' },
          sync: { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)' },
          async: { border: '#84cc16', bg: 'rgba(132, 204, 22, 0.2)' }
        };

        // Service Latency Comparison Chart (Bar)
        const serviceComparisonEl = document.getElementById("serviceComparisonChart");
        if (serviceComparisonEl && cw.router && cw.worker && cw.e2e) {
          new Chart(serviceComparisonEl, {
            type: "bar",
            data: {
              labels: ["P50", "P95", "P99"],
              datasets: [
                {
                  label: "Router Lambda",
                  data: [
                    parseFloat(cw.router.p50_ms) || 0,
                    parseFloat(cw.router.p95_ms) || 0,
                    parseFloat(cw.router.p99_ms) || 0
                  ],
                  backgroundColor: colors.router.bg,
                  borderColor: colors.router.border,
                  borderWidth: 2
                },
                {
                  label: "Worker Lambda",
                  data: [
                    parseFloat(cw.worker.p50_ms) || 0,
                    parseFloat(cw.worker.p95_ms) || 0,
                    parseFloat(cw.worker.p99_ms) || 0
                  ],
                  backgroundColor: colors.worker.bg,
                  borderColor: colors.worker.border,
                  borderWidth: 2
                },
                {
                  label: "Server E2E",
                  data: [
                    parseFloat(cw.e2e.p50_e2e_ms) || 0,
                    parseFloat(cw.e2e.p95_e2e_ms) || 0,
                    parseFloat(cw.e2e.p99_e2e_ms) || 0
                  ],
                  backgroundColor: colors.e2e.bg,
                  borderColor: colors.e2e.border,
                  borderWidth: 2
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: {
                mode: 'index',
                intersect: false
              },
              plugins: {
                legend: { position: "top" },
                tooltip: {
                  mode: 'index',
                  intersect: false,
                  callbacks: {
                    label: function(context) {
                      return context.dataset.label + ": " + msFmt.format(context.parsed.y) + " ms";
                    }
                  }
                }
              },
              scales: {
                y: {
                  title: { display: true, text: "Latency (ms)" },
                  beginAtZero: true
                }
              }
            }
          });
        }

        // E2E Timeline Breakdown Chart (Stacked Bar)
        const e2eTimelineEl = document.getElementById("e2eTimelineChart");
        const e2eBreakdownTableEl = document.getElementById("e2eBreakdownTable");
        if (e2eTimelineEl && cw.e2e) {
          const queueWait = parseFloat(cw.e2e.avg_queue_wait_ms) || 0;
          const workerTime = parseFloat(cw.e2e.avg_worker_ms) || 0;
          const syncResp = parseFloat(cw.e2e.avg_sync_response_ms) || 0;
          const asyncResp = parseFloat(cw.e2e.avg_async_response_ms) || 0;
          const total = syncResp + queueWait + workerTime + asyncResp;

          // Breakdown 테이블 생성
          if (e2eBreakdownTableEl) {
            const components = [
              { name: "Sync Response", value: syncResp, color: colors.sync.border },
              { name: "Queue Wait", value: queueWait, color: colors.queue.border },
              { name: "Worker Processing", value: workerTime, color: colors.worker.border },
              { name: "Async Response", value: asyncResp, color: colors.async.border }
            ];

            e2eBreakdownTableEl.innerHTML = components.map(function(comp) {
              const percentage = total > 0 ? (comp.value / total * 100) : 0;
              return '<tr>' +
                '<td><span style="display: inline-block; width: 12px; height: 12px; background: ' + comp.color + '; border-radius: 2px; margin-right: 6px;"></span>' + comp.name + '</td>' +
                '<td>' + msFmt.format(comp.value) + '</td>' +
                '<td>' + fmt.format(percentage) + '%</td>' +
                '</tr>';
            }).join('');
          }

          new Chart(e2eTimelineEl, {
            type: "bar",
            data: {
              labels: ["Request Flow"],
              datasets: [
                {
                  label: "Sync Response",
                  data: [syncResp],
                  backgroundColor: colors.sync.bg,
                  borderColor: colors.sync.border,
                  borderWidth: 2
                },
                {
                  label: "Queue Wait",
                  data: [queueWait],
                  backgroundColor: colors.queue.bg,
                  borderColor: colors.queue.border,
                  borderWidth: 2
                },
                {
                  label: "Worker Processing",
                  data: [workerTime],
                  backgroundColor: colors.worker.bg,
                  borderColor: colors.worker.border,
                  borderWidth: 2
                },
                {
                  label: "Async Response",
                  data: [asyncResp],
                  backgroundColor: colors.async.bg,
                  borderColor: colors.async.border,
                  borderWidth: 2
                }
              ]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: "top",
                  labels: {
                    generateLabels: function(chart) {
                      const data = chart.data;
                      return data.datasets.map(function(dataset, i) {
                        const value = dataset.data[0];
                        const percentage = total > 0 ? (value / total * 100) : 0;
                        return {
                          text: dataset.label + ': ' + msFmt.format(value) + 'ms (' + fmt.format(percentage) + '%)',
                          fillStyle: dataset.backgroundColor,
                          strokeStyle: dataset.borderColor,
                          lineWidth: dataset.borderWidth,
                          hidden: false,
                          index: i
                        };
                      });
                    }
                  }
                },
                tooltip: {
                  callbacks: {
                    label: function(context) {
                      const value = context.parsed.x;
                      const percentage = total > 0 ? (value / total * 100) : 0;
                      return context.dataset.label + ": " + msFmt.format(value) + " ms (" + fmt.format(percentage) + "%)";
                    }
                  }
                }
              },
              scales: {
                x: {
                  stacked: true,
                  title: { display: true, text: "Time (ms)" }
                },
                y: {
                  stacked: true
                }
              }
            }
          });
        }

        // Latency Comparison Chart (Line Chart without Max)
        const latencyComparisonEl = document.getElementById("latencyComparisonChart");
        if (latencyComparisonEl && cw.router && cw.worker && cw.e2e) {
          new Chart(latencyComparisonEl, {
            type: "line",
            data: {
              labels: ["Avg", "P50", "P95", "P99"],
              datasets: [
                {
                  label: "Router Lambda",
                  data: [
                    parseFloat(cw.router.avg_ms) || 0,
                    parseFloat(cw.router.p50_ms) || 0,
                    parseFloat(cw.router.p95_ms) || 0,
                    parseFloat(cw.router.p99_ms) || 0
                  ],
                  borderColor: colors.router.border,
                  backgroundColor: colors.router.bg,
                  tension: 0.3,
                  fill: true,
                  pointRadius: 5,
                  pointHoverRadius: 7
                },
                {
                  label: "Worker Lambda",
                  data: [
                    parseFloat(cw.worker.avg_ms) || 0,
                    parseFloat(cw.worker.p50_ms) || 0,
                    parseFloat(cw.worker.p95_ms) || 0,
                    parseFloat(cw.worker.p99_ms) || 0
                  ],
                  borderColor: colors.worker.border,
                  backgroundColor: colors.worker.bg,
                  tension: 0.3,
                  fill: true,
                  pointRadius: 5,
                  pointHoverRadius: 7
                },
                {
                  label: "Server E2E",
                  data: [
                    parseFloat(cw.e2e.avg_e2e_ms) || 0,
                    parseFloat(cw.e2e.p50_e2e_ms) || 0,
                    parseFloat(cw.e2e.p95_e2e_ms) || 0,
                    parseFloat(cw.e2e.p99_e2e_ms) || 0
                  ],
                  borderColor: colors.e2e.border,
                  backgroundColor: colors.e2e.bg,
                  tension: 0.3,
                  fill: true,
                  pointRadius: 5,
                  pointHoverRadius: 7
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: {
                mode: 'index',
                intersect: false
              },
              plugins: {
                legend: { position: "top" },
                tooltip: {
                  mode: 'index',
                  intersect: false,
                  callbacks: {
                    label: function(context) {
                      return context.dataset.label + ": " + msFmt.format(context.parsed.y) + " ms";
                    }
                  }
                }
              },
              scales: {
                y: {
                  title: { display: true, text: "Latency (ms)" },
                  beginAtZero: true
                }
              }
            }
          });
        }

        console.log("✓ CloudWatch metrics rendered");
      }

      // 일관된 색상 팔레트 정의 (전역)
      const chartColors = {
        primary: { border: '#2856f7', bg: 'rgba(40, 86, 247, 0.2)' },
        secondary: { border: '#14b8a6', bg: 'rgba(20, 184, 166, 0.2)' },
        tertiary: { border: '#f97316', bg: 'rgba(249, 115, 22, 0.2)' },
        quaternary: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)' },
        quinary: { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)' },
        senary: { border: '#84cc16', bg: 'rgba(132, 204, 22, 0.2)' }
      };

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
              borderColor: chartColors.primary.border,
              backgroundColor: chartColors.primary.bg,
              tension: 0.3,
            },
            {
              label: "P95",
              data: data.series.map((point) => point.p95),
              borderColor: chartColors.secondary.border,
              backgroundColor: chartColors.secondary.bg,
              tension: 0.3,
            },
            {
              label: "P99",
              data: data.series.map((point) => point.p99),
              borderColor: chartColors.tertiary.border,
              backgroundColor: chartColors.tertiary.bg,
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
            y: { title: { display: true, text: "ms" }, beginAtZero: true },
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
              borderColor: chartColors.tertiary.border,
              backgroundColor: chartColors.tertiary.bg,
              tension: 0.25,
              fill: true,
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
            y: { title: { display: true, text: "req/s" }, beginAtZero: true },
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
              backgroundColor: chartColors.primary.bg,
              borderColor: chartColors.primary.border,
              borderWidth: 2,
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
            y: { title: { display: true, text: "ms" }, beginAtZero: true },
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
                backgroundColor: chartColors.secondary.bg,
                borderColor: chartColors.secondary.border,
                borderWidth: 2,
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
              y: { title: { display: true, text: "Count" }, beginAtZero: true },
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
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                borderColor: '#ef4444',
                borderWidth: 2,
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
              x: { title: { display: true, text: "Count" }, beginAtZero: true },
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
