#!/bin/bash
# View Artillery test results in terminal

# metrics.json 파일 제외하고 실제 Artillery 테스트 결과만 찾기
LATEST_JSON=$(ls -t results/*-test-*.json 2>/dev/null | grep -v '\.metrics\.json' | head -n1)

if [ -z "$LATEST_JSON" ]; then
  echo "No test results found"
  exit 1
fi

# 대응하는 metrics.json 파일 확인
METRICS_JSON="${LATEST_JSON%.json}.metrics.json"
HAS_METRICS=0
if [ -f "$METRICS_JSON" ]; then
  HAS_METRICS=1
fi

echo "========================================"
echo "Performance Test Results"
echo "========================================"
echo "File: $LATEST_JSON"
if [ $HAS_METRICS -eq 1 ]; then
  echo "Metrics: $METRICS_JSON (CloudWatch + E2E Data)"
fi
echo ""

if ! command -v jq &> /dev/null; then
  echo "⚠️  jq not installed. Showing raw summary..."
  echo ""
  cat "$LATEST_JSON" | grep -A 50 "aggregate"
else
  echo "Summary Statistics:"
  echo "----------------------------------------"

  # Overall stats
  echo ""
  echo "📊 Request Statistics:"
  jq -r '.aggregate.counters | to_entries[] | "  \(.key): \(.value)"' "$LATEST_JSON"

  echo ""
  echo "⏱️  Response Time (ms):"
  jq -r '.aggregate.summaries["http.response_time"] |
    "  Min:    \(.min)",
    "  Max:    \(.max)",
    "  Median: \(.median)",
    "  P95:    \(.p95)",
    "  P99:    \(.p99)"' "$LATEST_JSON"

  echo ""
  echo "🎯 Latency Percentiles (ms):"
  jq -r '.aggregate.histograms["http.response_time"] | to_entries[] |
    select(.key | tonumber? != null) |
    "  P\(.key): \(.value)"' "$LATEST_JSON" | sort -t: -k1 -V | head -10

  echo ""
  echo "📈 Throughput:"
  DURATION=$(jq -r '.aggregate.summaries["vusers.session_length"].max // 0' "$LATEST_JSON")
  REQUESTS=$(jq -r '.aggregate.counters["http.requests"] // 0' "$LATEST_JSON")
  if [ "$DURATION" != "0" ]; then
    RPS=$(echo "scale=2; $REQUESTS / ($DURATION / 1000)" | bc)
    echo "  Requests: $REQUESTS"
    echo "  Duration: ${DURATION}ms"
    echo "  Avg RPS:  $RPS req/s"
  fi

  echo ""
  echo "❌ Error Codes:"
  jq -r '.aggregate.codes // {} | to_entries[] | "  \(.key): \(.value)"' "$LATEST_JSON"

  echo ""
  echo "🔍 Errors:"
  ERROR_COUNT=$(jq -r '.aggregate.counters["errors.total"] // 0' "$LATEST_JSON")
  if [ "$ERROR_COUNT" != "0" ]; then
    jq -r '.aggregate.errors // {} | to_entries[] | "  \(.key): \(.value)"' "$LATEST_JSON"
  else
    echo "  No errors"
  fi

  echo ""
  echo "========================================"

  # Check thresholds
  echo ""
  echo "Threshold Check:"
  echo "----------------------------------------"

  P95=$(jq -r '.aggregate.summaries["http.response_time"].p95 // 0' "$LATEST_JSON")
  P99=$(jq -r '.aggregate.summaries["http.response_time"].p99 // 0' "$LATEST_JSON")
  ERROR_RATE=$(echo "scale=4; $ERROR_COUNT * 100 / $REQUESTS" | bc 2>/dev/null || echo "0")

  echo "  P95 < 2000ms:  $P95 ms $([ $(echo "$P95 < 2000" | bc) -eq 1 ] && echo "✓" || echo "✗")"
  echo "  P99 < 3000ms:  $P99 ms $([ $(echo "$P99 < 3000" | bc) -eq 1 ] && echo "✓" || echo "✗")"
  echo "  Error < 1%:    ${ERROR_RATE}% $([ $(echo "$ERROR_RATE < 1" | bc) -eq 1 ] && echo "✓" || echo "✗")"

  # CloudWatch Metrics가 있으면 표시
  if [ $HAS_METRICS -eq 1 ]; then
    echo ""
    echo "========================================"
    echo "CloudWatch & E2E Metrics"
    echo "========================================"

    echo ""
    echo "📊 Router Lambda (API Gateway → Router):"
    echo "----------------------------------------"
    jq -r '.cloudwatch.router | "  Invocations: \(.invocations)\n  Avg:         \(.avg_ms) ms\n  P50:         \(.p50_ms) ms\n  P95:         \(.p95_ms) ms\n  P99:         \(.p99_ms) ms\n  Max:         \(.max_ms) ms"' "$METRICS_JSON"

    echo ""
    echo "⚙️  Worker Lambda (EventBridge → SQS → Worker):"
    echo "----------------------------------------"
    jq -r '.cloudwatch.worker | "  Invocations: \(.invocations)\n  Avg:         \(.avg_ms) ms\n  P50:         \(.p50_ms) ms\n  P95:         \(.p95_ms) ms\n  P99:         \(.p99_ms) ms\n  Max:         \(.max_ms) ms"' "$METRICS_JSON"

    echo ""
    echo "🔄 End-to-End (API Gateway → Worker Lambda Completion):"
    echo "----------------------------------------"
    E2E_DATA=$(jq -r '.cloudwatch.e2e // {} | length' "$METRICS_JSON")
    if [ "$E2E_DATA" -eq 0 ]; then
      echo "  ⚠️  No E2E data available (Router not propagating correlation IDs)"
    else
      jq -r '.cloudwatch.e2e | "  Invocations: \(.invocations)\n  Avg:         \(.avg_ms) ms\n  P50:         \(.p50_ms) ms\n  P95:         \(.p95_ms) ms\n  P99:         \(.p99_ms) ms\n  Max:         \(.max_ms) ms"' "$METRICS_JSON"
    fi

    echo ""
    echo "❌ Errors:"
    echo "----------------------------------------"
    jq -r '.cloudwatch.errors | "  Router:      \(.router)\n  Worker:      \(.worker)"' "$METRICS_JSON"

    echo ""
    echo "⏱️  Test Time Range:"
    echo "----------------------------------------"
    jq -r '.timeRange | "  Start:       \((.startMs / 1000 | floor) | todate)\n  End:         \((.endMs / 1000 | floor) | todate)\n  Duration:    \(.durationMs) ms (\((.durationMs / 1000) | floor) sec)"' "$METRICS_JSON"
  fi

fi

echo ""
echo "========================================"
echo ""
echo "💡 Tip: Use 'make perf-test-analyze-test' to update CloudWatch metrics"
echo ""
