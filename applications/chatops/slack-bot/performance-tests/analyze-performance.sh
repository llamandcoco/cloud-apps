#!/bin/bash
# Analyze performance test results from CloudWatch Logs

set -e

ENVIRONMENT="${ENVIRONMENT:-plt}"
REGION="ca-central-1"

# Check for flags
OUTPUT_JSON=false
USE_TEST_RESULT=false
QUIET_MODE=false

for arg in "$@"; do
  case $arg in
    --from-test)
      USE_TEST_RESULT=true
      shift
      ;;
    --json)
      OUTPUT_JSON=true
      shift
      ;;
    --quiet|-q)
      QUIET_MODE=true
      shift
      ;;
  esac
done

# Helper: echo only if not quiet
echo_info() {
  if [ "$QUIET_MODE" = false ]; then
    echo "$@"
  fi
}

# Helper: macOS/Linux compatible date conversion
timestamp_to_date() {
  local ts=$1
  if [ "$(uname)" = "Darwin" ]; then
    date -r "$ts" '+%Y-%m-%d %H:%M:%S'
  else
    date -d "@$ts" '+%Y-%m-%d %H:%M:%S'
  fi
}

# Helper: Calculate time N minutes ago (macOS/Linux compatible)
minutes_ago_timestamp() {
  local minutes=$1
  local now=$(date +%s)
  echo $((now - (minutes * 60)))
}


# Determine time range
if [ "$USE_TEST_RESULT" = true ]; then
  # Use latest Artillery test result
  LATEST_RESULT=$(ls -t results/*.json 2>/dev/null | head -1)
  
  if [ -z "$LATEST_RESULT" ]; then
    echo "Error: No Artillery test results found in results/ directory"
    exit 1
  fi
  
  echo "Using time range from: $LATEST_RESULT"
  
  # Extract timestamps from Artillery JSON
  read START_TIMESTAMP END_TIMESTAMP < <(
    node -pe "
      const data = require('./$LATEST_RESULT');
      const start = data.aggregate.firstMetricAt || data.rawAggregate.firstMetricAt;
      const end = data.aggregate.lastMetricAt || data.rawAggregate.lastMetricAt;
      \`\${start} \${end}\`
    "
  )
  
  if [ -z "$START_TIMESTAMP" ] || [ -z "$END_TIMESTAMP" ]; then
    echo "Error: Could not extract timestamps from $LATEST_RESULT"
    exit 1
  fi
  
  START_TIME_HUMAN=$(timestamp_to_date $((START_TIMESTAMP / 1000)))
  END_TIME_HUMAN=$(timestamp_to_date $((END_TIMESTAMP / 1000)))
  
  echo_info "Test window: $START_TIME_HUMAN ~ $END_TIME_HUMAN"
  echo_info ""
else
  # Use traditional time range (last N minutes)
  START_TIME="${1:-15}"
  echo_info "Analyzing last ${START_TIME} minutes of logs..."
  echo_info ""
  
  # Calculate timestamps (seconds, for AWS CLI)
  END_TIMESTAMP=$(date +%s)
  START_TIMESTAMP=$((END_TIMESTAMP - (START_TIME * 60)))
fi

# Add 5-minute buffer to end time to account for log ingestion delay
END_TIMESTAMP_BUFFERED=$((END_TIMESTAMP + 300))

# Initialize JSON output structure
if [ "$OUTPUT_JSON" = true ]; then
  JSON_OUTPUT="{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"environment\":\"$ENVIRONMENT\",\"timeRange\":{\"start\":$((START_TIMESTAMP * 1000)),\"end\":$((END_TIMESTAMP * 1000))},\"metrics\":{}}"
fi

echo_info "========================================"
echo_info "Component Performance Analysis"
echo_info "========================================"
echo_info "Environment: ${ENVIRONMENT}"
echo_info ""

# 0. End-to-End Latency & Component Breakdown (from Performance metrics log)
echo_info "0. End-to-End Latency & Component Breakdown"
echo_info "----------------------------------------"
echo_info "Note: Using structured Performance metrics from echo worker"
echo_info ""
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-chatbot-echo-worker" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, totalE2eMs, workerDurationMs, queueWaitMs, syncResponseMs, asyncResponseMs
| filter message = "Performance metrics"
| stats
    count() as requests,
    avg(totalE2eMs) as avg_e2e_ms,
    percentile(totalE2eMs, 50) as p50_e2e_ms,
    percentile(totalE2eMs, 95) as p95_e2e_ms,
    percentile(totalE2eMs, 99) as p99_e2e_ms,
    max(totalE2eMs) as max_e2e_ms,
    avg(workerDurationMs) as avg_worker_ms,
    avg(queueWaitMs) as avg_queue_wait_ms,
    avg(syncResponseMs) as avg_sync_response_ms,
    avg(asyncResponseMs) as avg_async_response_ms
' > /tmp/e2e-query.json 2>/dev/null || echo "  ⚠ E2E tracking not available (Performance metrics not found in logs)"

if [ -f /tmp/e2e-query.json ]; then
  E2E_QUERY_ID=$(cat /tmp/e2e-query.json | jq -r '.queryId' 2>/dev/null)
  if [ "$E2E_QUERY_ID" != "null" ] && [ -n "$E2E_QUERY_ID" ]; then
    sleep 8
    aws logs get-query-results --query-id ${E2E_QUERY_ID} --region ${REGION} --output table 2>/dev/null || echo "  ⚠ Query failed"
  fi
fi

echo ""

# 1. Router Lambda Performance
echo "1. API Gateway → Router Lambda"
echo "----------------------------------------"
echo "Note: Counting START events to capture all invocations (including failed)"
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-slack-router" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, @requestId
| filter @type = "START"
| stats count() as total_invocations
' > /tmp/router-start-query.json

ROUTER_START_QUERY_ID=$(cat /tmp/router-start-query.json | jq -r '.queryId')

# Also get REPORT metrics for performance data
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-slack-router" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, @duration, @billedDuration, @memorySize, @maxMemoryUsed
| filter @type = "REPORT"
| stats
    count() as completed_invocations,
    avg(@duration) as avg_duration_ms,
    percentile(@duration, 50) as p50_ms,
    percentile(@duration, 95) as p95_ms,
    percentile(@duration, 99) as p99_ms,
    max(@duration) as max_ms,
    avg(@maxMemoryUsed / 1024 / 1024) as avg_memory_mb,
    max(@maxMemoryUsed / 1024 / 1024) as max_memory_mb
' > /tmp/router-query.json

ROUTER_QUERY_ID=$(cat /tmp/router-query.json | jq -r '.queryId')

# Wait for queries to complete
sleep 5

echo "Total Invocations (START events):"
aws logs get-query-results \
  --query-id ${ROUTER_START_QUERY_ID} \
  --region ${REGION} \
  --output table

echo ""
echo "Completed Invocations (REPORT events with performance data):"
aws logs get-query-results \
  --query-id ${ROUTER_QUERY_ID} \
  --region ${REGION} \
  --output table

echo ""

# 2. Echo Worker Lambda Performance
echo "2. Echo Worker Lambda"
echo "----------------------------------------"
echo "Note: Counting START events to capture all invocations (including failed)"
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-chatbot-echo-worker" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, @requestId
| filter @type = "START"
| stats count() as total_invocations
' > /tmp/worker-start-query.json

WORKER_START_QUERY_ID=$(cat /tmp/worker-start-query.json | jq -r '.queryId')

# Also get REPORT metrics for performance data
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-chatbot-echo-worker" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, @duration, @billedDuration, @memorySize, @maxMemoryUsed
| filter @type = "REPORT"
| stats
    count() as completed_invocations,
    avg(@duration) as avg_duration_ms,
    percentile(@duration, 50) as p50_ms,
    percentile(@duration, 95) as p95_ms,
    percentile(@duration, 99) as p99_ms,
    max(@duration) as max_ms,
    avg(@maxMemoryUsed / 1024 / 1024) as avg_memory_mb,
    max(@maxMemoryUsed / 1024 / 1024) as max_memory_mb
' > /tmp/worker-query.json

WORKER_QUERY_ID=$(cat /tmp/worker-query.json | jq -r '.queryId')

sleep 5

echo "Total Invocations (START events):"
aws logs get-query-results \
  --query-id ${WORKER_START_QUERY_ID} \
  --region ${REGION} \
  --output table

echo ""
echo "Completed Invocations (REPORT events with performance data):"
aws logs get-query-results \
  --query-id ${WORKER_QUERY_ID} \
  --region ${REGION} \
  --output table

echo ""

# 3. Error Analysis
echo "3. Error Analysis"
echo "----------------------------------------"
echo "Router Errors:"
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-slack-router" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, @message
| filter @message like /ERROR/ or @message like /Invalid signature/
| stats count() as error_count by @message
| limit 20
' > /tmp/router-errors.json

ROUTER_ERROR_ID=$(cat /tmp/router-errors.json | jq -r '.queryId')
sleep 5
aws logs get-query-results --query-id ${ROUTER_ERROR_ID} --region ${REGION} --output table

echo ""
echo "Worker Errors:"
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-chatbot-echo-worker" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, @message
| filter @message like /ERROR/ or level = "error"
| stats count() as error_count by @message
| limit 20
' > /tmp/worker-errors.json

WORKER_ERROR_ID=$(cat /tmp/worker-errors.json | jq -r '.queryId')
sleep 5
aws logs get-query-results --query-id ${WORKER_ERROR_ID} --region ${REGION} --output table

echo ""

# 4. Cold Starts
echo "4. Cold Start Analysis"
echo "----------------------------------------"
echo "Router Cold Starts:"
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-slack-router" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, @initDuration
| filter @type = "REPORT" and ispresent(@initDuration)
| stats
    count() as cold_starts,
    avg(@initDuration) as avg_init_ms,
    max(@initDuration) as max_init_ms
' > /tmp/router-cold.json

ROUTER_COLD_ID=$(cat /tmp/router-cold.json | jq -r '.queryId')
sleep 5
aws logs get-query-results --query-id ${ROUTER_COLD_ID} --region ${REGION} --output table

echo ""
echo "Worker Cold Starts:"
aws logs start-query \
  --log-group-name "/aws/lambda/laco-${ENVIRONMENT}-chatbot-echo-worker" \
  --start-time ${START_TIMESTAMP} \
  --end-time ${END_TIMESTAMP_BUFFERED} \
  --region ${REGION} \
  --query-string '
fields @timestamp, @initDuration
| filter @type = "REPORT" and ispresent(@initDuration)
| stats
    count() as cold_starts,
    avg(@initDuration) as avg_init_ms,
    max(@initDuration) as max_init_ms
' > /tmp/worker-cold.json

WORKER_COLD_ID=$(cat /tmp/worker-cold.json | jq -r '.queryId')
sleep 5
aws logs get-query-results --query-id ${WORKER_COLD_ID} --region ${REGION} --output table

echo_info ""
echo_info "========================================"
echo_info "CloudWatch Metrics (Lambda)"
echo_info "========================================"

# Skip CloudWatch Metrics in quiet mode (optional, can fail)
if [ "$QUIET_MODE" = true ]; then
  echo_info "(Skipped in quiet mode)"
else

# 5. Concurrent Executions
echo_info ""
echo_info "5. Concurrent Executions"
echo_info "----------------------------------------"

echo_info "Router Lambda:"
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name ConcurrentExecutions \
  --dimensions Name=FunctionName,Value=laco-${ENVIRONMENT}-slack-router \
  --start-time $(date -u -d @$START_TIMESTAMP +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r $START_TIMESTAMP +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Maximum,Average \
  --region ${REGION} \
  --output table

echo_info ""
echo_info "Echo Worker Lambda:"
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name ConcurrentExecutions \
  --dimensions Name=FunctionName,Value=laco-${ENVIRONMENT}-chatbot-echo-worker \
  --start-time $(date -u -d @$START_TIMESTAMP +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r $START_TIMESTAMP +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Maximum,Average \
  --region ${REGION} \
  --output table

echo_info ""
echo_info "6. Throttles"
echo_info "----------------------------------------"

echo_info "Router Throttles:"
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Throttles \
  --dimensions Name=FunctionName,Value=laco-${ENVIRONMENT}-slack-router \
  --start-time $(date -u -d @$START_TIMESTAMP +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r $START_TIMESTAMP +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum \
  --region ${REGION} \
  --output table

echo_info ""
echo_info "Worker Throttles:"
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Throttles \
  --dimensions Name=FunctionName,Value=laco-${ENVIRONMENT}-chatbot-echo-worker \
  --start-time $(date -u -d @$START_TIMESTAMP +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r $START_TIMESTAMP +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum \
  --region ${REGION} \
  --output table

echo_info ""
echo_info "========================================"
echo_info "SQS Metrics"
echo_info "========================================"

# 7. SQS Queue Metrics
echo_info ""
echo_info "7. SQS Queue Age"
echo_info "----------------------------------------"

aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateAgeOfOldestMessage \
  --dimensions Name=QueueName,Value=laco-${ENVIRONMENT}-chatbot-echo \
  --start-time $(date -u -d @$START_TIMESTAMP +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r $START_TIMESTAMP +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum \
  --region ${REGION} \
  --output table

echo_info ""
echo_info "8. SQS Queue Depth"
echo_info "----------------------------------------"

aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=laco-${ENVIRONMENT}-chatbot-echo \
  --start-time $(date -u -d @$START_TIMESTAMP +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -r $START_TIMESTAMP +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum \
  --region ${REGION} \
  --output table

fi  # End of quiet mode skip

echo_info ""
echo_info "========================================"
echo_info "Component-Level Breakdown"
echo_info "========================================"
echo_info ""
echo_info "Latency breakdown from Performance metrics (Section 0):"
echo_info ""
echo_info "┌──────────────────────────────────────────────────────────┐"
echo_info "│ Component Flow                    │ Metric             │"
echo_info "├──────────────────────────────────────────────────────────┤"
echo_info "│ 1. API Gateway → Router Lambda    │ See section 1      │"
echo_info "│ 2. Router → EventBridge → SQS     │ avg_queue_wait_ms  │"
echo_info "│ 3. Worker Lambda Processing       │ avg_worker_ms      │"
echo_info "│    ├─ Sync Response               │ avg_sync_resp_ms   │"
echo_info "│    └─ Async Response              │ avg_async_resp_ms  │"
echo_info "│ Total E2E (API Gateway → Done)    │ avg_e2e_ms         │"
echo_info "└──────────────────────────────────────────────────────────┘"
echo_info ""
echo_info "Formula:"
echo_info "  totalE2eMs = workerDurationMs + queueWaitMs"
echo_info "  queueWaitMs = Router processing + EventBridge + SQS polling"
echo_info ""
echo_info "========================================"
echo_info "Analysis Complete"
echo_info "========================================"
echo_info ""
echo_info "Summary: Component performance analyzed with structured metrics"
echo_info ""
echo_info "Key Metrics to Check:"
echo_info "  1. E2E P95 < 3000ms           (Total user experience)"
echo_info "  2. Queue Wait avg < 1000ms    (Router + EventBridge + SQS)"
echo_info "  3. Worker P95 < 2500ms        (Command processing)"
echo_info "  4. Sync Response < 500ms      (First Slack response)"
echo_info "  5. No throttles               (Concurrency OK)"
echo_info "  6. Error rate < 1%            (System stable)"
echo_info ""
