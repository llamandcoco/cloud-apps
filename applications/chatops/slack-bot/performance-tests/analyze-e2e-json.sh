#!/bin/bash
# Extract E2E performance metrics from Artillery test and CloudWatch Logs
# Output: JSON format for dashboard integration

set -e

ENVIRONMENT="${ENVIRONMENT:-plt}"
REGION="ca-central-1"

# Find latest Artillery test result (exclude .metrics.json files)
LATEST_RESULT=$(ls -t results/*.json 2>/dev/null | grep -v '\.metrics\.json' | head -1)

if [ -z "$LATEST_RESULT" ]; then
  echo '{"error": "No Artillery test results found"}' >&2
  exit 1
fi

echo "Analyzing: $LATEST_RESULT" >&2

# Extract timestamps from Artillery JSON
read START_MS END_MS < <(
  node -pe "
    const data = require('./$LATEST_RESULT');
    const agg = data.aggregate || data.rawAggregate || {};
    const start = agg.firstMetricAt || 0;
    const end = agg.lastMetricAt || 0;
    \`\${start} \${end}\`
  "
)

if [ "$START_MS" = "0" ] || [ "$END_MS" = "0" ]; then
  echo '{"error": "Could not extract timestamps from Artillery result"}' >&2
  exit 1
fi

# Helper function to execute query and wait for results
query_logs() {
  local log_group=$1
  local query_string=$2
  local metric_name=$3
  
  # Convert milliseconds to seconds for AWS Logs API
  local start_sec=$((START_MS / 1000))
  local end_sec=$((END_MS / 1000))
  # Add 5-minute buffer to account for log ingestion delay
  local end_sec_buffered=$((end_sec + 300))
  
  local query_id=$(aws logs start-query \
    --log-group-name "$log_group" \
    --start-time $start_sec \
    --end-time $end_sec_buffered \
    --region $REGION \
    --query-string "$query_string" \
    --query 'queryId' \
    --output text)
  
  # Wait for query to complete
  sleep 5
  
  aws logs get-query-results \
    --query-id "$query_id" \
    --region $REGION \
    --output json | jq -r '.results'
}

# 1. Router Lambda Performance
# Note: Using REPORT filter which counts only completed invocations
# If count differs from Artillery requests, check CloudWatch for:
# - Lambda initialization errors (no REPORT logged)
# - Timeouts (REPORT may be delayed beyond query window)
# - API Gateway errors (request never reached Lambda)
echo "Querying Router Lambda metrics..." >&2
ROUTER_METRICS=$(query_logs \
  "/aws/lambda/laco-${ENVIRONMENT}-slack-router" \
  "fields @duration | filter @type = \"REPORT\" | stats count() as invocations, avg(@duration) as avg_ms, percentile(@duration, 50) as p50_ms, percentile(@duration, 95) as p95_ms, percentile(@duration, 99) as p99_ms, max(@duration) as max_ms" \
  "router")

# 2. Worker Lambda Performance
# Note: Using REPORT filter which counts only completed invocations
# Difference between Router and Worker counts indicates:
# - SQS message loss or DLQ routing
# - Worker timeouts or initialization failures
echo "Querying Worker Lambda metrics..." >&2
WORKER_METRICS=$(query_logs \
  "/aws/lambda/laco-${ENVIRONMENT}-chatbot-command-sr-worker" \
  "fields @duration | filter @type = \"REPORT\" | stats count() as invocations, avg(@duration) as avg_ms, percentile(@duration, 50) as p50_ms, percentile(@duration, 95) as p95_ms, percentile(@duration, 99) as p99_ms, max(@duration) as max_ms" \
  "worker")

# 3. End-to-End Latency & Component Breakdown (from Performance metrics)
echo "Querying E2E latency & component breakdown..." >&2
E2E_METRICS=$(query_logs \
  "/aws/lambda/laco-${ENVIRONMENT}-chatbot-command-sr-worker" \
  "fields totalE2eMs, queueWaitMs, workerDurationMs, syncResponseMs, asyncResponseMs | filter message = \"Performance metrics\" | stats count() as requests, avg(totalE2eMs) as avg_e2e_ms, percentile(totalE2eMs, 50) as p50_e2e_ms, percentile(totalE2eMs, 95) as p95_e2e_ms, percentile(totalE2eMs, 99) as p99_e2e_ms, avg(queueWaitMs) as avg_queue_wait_ms, avg(workerDurationMs) as avg_worker_ms, avg(syncResponseMs) as avg_sync_response_ms, avg(asyncResponseMs) as avg_async_response_ms" \
  "e2e" 2>/dev/null || echo "[]")

# 4. Error Analysis
echo "Querying errors..." >&2
ROUTER_ERRORS=$(query_logs \
  "/aws/lambda/laco-${ENVIRONMENT}-slack-router" \
  "fields @message | filter level = \"error\" or @message like /ERROR/ | stats count() as error_count" \
  "router_errors" 2>/dev/null || echo "[]")

WORKER_ERRORS=$(query_logs \
  "/aws/lambda/laco-${ENVIRONMENT}-chatbot-command-sr-worker" \
  "fields @message | filter level = \"error\" or @message like /ERROR/ | stats count() as error_count" \
  "worker_errors" 2>/dev/null || echo "[]")

# Parse Artillery metrics
ARTILLERY_SUMMARY=$(node -pe "
  const data = require('./$LATEST_RESULT');
  const agg = data.aggregate || {};
  const counters = agg.counters || {};
  const summaries = agg.summaries || {};
  const responseTime = summaries['http.response_time'] || {};
  JSON.stringify({
    requests: counters['http.requests'] || 0,
    responses: counters['http.responses'] || 0,
    errors: counters['errors.ETIMEDOUT'] || counters['vusers.failed'] || 0,
    errorRate: counters['http.requests'] ? ((counters['vusers.failed'] || 0) / counters['http.requests'] * 100).toFixed(2) : 0,
    avgRps: (counters['http.requests'] || 0) / ((data.aggregate.lastMetricAt - data.aggregate.firstMetricAt) / 1000) || 0,
    p50: responseTime.median || 0,
    p95: responseTime.p95 || 0,
    p99: responseTime.p99 || 0,
    durationMs: (data.aggregate.lastMetricAt - data.aggregate.firstMetricAt) || 0
  });
")

# Determine output file name (testname.metrics.json)
TESTNAME=$(basename "$LATEST_RESULT" .json)
METRICS_FILE="results/${TESTNAME}.metrics.json"

# Build final JSON output
cat <<EOF > "$METRICS_FILE"
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "environment": "$ENVIRONMENT",
  "testFile": "$LATEST_RESULT",
  "timeRange": {
    "startMs": $START_MS,
    "endMs": $END_MS,
    "durationMs": $((END_MS - START_MS))
  },
  "artillery": $ARTILLERY_SUMMARY,
  "cloudwatch": {
    "router": $(echo "$ROUTER_METRICS" | jq -r 'if type == "array" and length > 0 then .[0] | map({(.field): .value}) | add else {} end'),
    "worker": $(echo "$WORKER_METRICS" | jq -r 'if type == "array" and length > 0 then .[0] | map({(.field): .value}) | add else {} end'),
    "e2e": $(echo "$E2E_METRICS" | jq -r 'if type == "array" and length > 0 then .[0] | map({(.field): .value}) | add else {} end'),
    "errors": {
      "router": $(echo "$ROUTER_ERRORS" | jq -r 'if type == "array" and length > 0 then (.[0] | map(select(.field == "error_count") | .value) | .[0] // 0) else 0 end'),
      "worker": $(echo "$WORKER_ERRORS" | jq -r 'if type == "array" and length > 0 then (.[0] | map(select(.field == "error_count") | .value) | .[0] // 0) else 0 end')
    }
  }
}
EOF

echo "" >&2
echo "✓ Metrics saved to: $METRICS_FILE" >&2
echo "Analysis complete!" >&2
