#!/bin/bash
#
# End-to-End Manual Test Script
# Tests full flow: Slack → Router → EventBridge → Worker → Slack API
#
# Prerequisites:
#   1. LocalStack running: docker-compose -f docker-compose.local.yml up -d
#   2. Router Lambda deployed (or running locally on port 3000)
#   3. Environment variables set (see below)
#
# Usage:
#   ./scripts/test-e2e.sh [endpoint-url] [command] [text]
#
#   Examples:
#   ./scripts/test-e2e.sh http://localhost:3000/slack/commands /echo "hello world"
#   ./scripts/test-e2e.sh https://abc123.execute-api.ca-central-1.amazonaws.com/dev/slack/commands /echo "test"

set -e

ENDPOINT_URL="${1:-http://localhost:3000/slack/commands}"
COMMAND="${2:-/echo}"
TEXT="${3:-test from curl}"
SLACK_SIGNING_SECRET="${SLACK_SIGNING_SECRET:-test-signing-secret}"

# Validate inputs
if [ -z "$SLACK_SIGNING_SECRET" ]; then
  echo "❌ Error: SLACK_SIGNING_SECRET not set"
  exit 1
fi

echo "🚀 Testing Slack Bot E2E"
echo "   Endpoint: $ENDPOINT_URL"
echo "   Command: $COMMAND"
echo "   Text: $TEXT"
echo ""

# Generate Slack signature headers
generate_headers() {
  local body="$1"
  local timestamp=$(date +%s)
  
  # Compute HMAC-SHA256
  local sig_base_string="v0:${timestamp}:${body}"
  local signature=$(echo -n "$sig_base_string" | openssl dgst -sha256 -hmac "$SLACK_SIGNING_SECRET" -hex | awk '{print $2}')
  
  echo "-H 'X-Slack-Request-Timestamp: $timestamp' -H 'X-Slack-Signature: v0=$signature'"
}

# Build request body
RESPONSE_URL="https://hooks.slack.com/commands/test/test/test"
BODY="command=$(echo -n "$COMMAND" | jq -sRr @uri)&text=$(echo -n "$TEXT" | jq -sRr @uri)&response_url=$(echo -n "$RESPONSE_URL" | jq -sRr @uri)&user_id=U123&user_name=testuser&channel_id=C123&channel_name=general&team_id=T123&team_domain=test&trigger_id=trigger123"

# Generate headers
HEADERS=$(generate_headers "$BODY")

echo "📤 Sending request..."
echo ""

# Send request
eval "curl -X POST '$ENDPOINT_URL' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  $HEADERS \
  -d '$BODY' \
  -v"

echo ""
echo "✓ Request sent"
echo ""
echo "Next steps:"
echo "  1. Check CloudWatch Logs for Router Lambda"
echo "  2. Verify EventBridge received event"
echo "  3. Check SQS queue for worker message"
echo "  4. Monitor worker Lambda response"
