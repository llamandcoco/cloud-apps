#!/bin/bash
# Test Slack signature with curl

set -e

# Check if API Gateway URL is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <API_GATEWAY_URL>"
  echo ""
  echo "Example:"
  echo "  $0 https://xxxxxx.execute-api.ca-central-1.amazonaws.com/prod/slack"
  echo ""
  exit 1
fi

API_GATEWAY_URL="$1"
ENVIRONMENT="${ENVIRONMENT:-plt}"

echo "========================================"
echo "Slack Signature Test with curl"
echo "========================================"
echo ""

# Get signing secret from SSM
echo "Fetching Slack signing secret..."
SIGNING_SECRET=$(aws ssm get-parameter \
  --name "/laco/${ENVIRONMENT}/aws/secrets/slack/signing-secret" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text \
  --region ca-central-1)

if [ -z "$SIGNING_SECRET" ]; then
  echo "ERROR: Could not fetch signing secret"
  exit 1
fi

echo "✓ Signing secret retrieved"
echo ""

# Prepare request
TIMESTAMP=$(date +%s)
BODY="token=test&team_id=T123&team_domain=test&channel_id=C123&channel_name=general&user_id=U1234&user_name=testuser&command=/echo&text=test message&response_url=https://hooks.slack.com/test&trigger_id=123.456"

echo "Request details:"
echo "  Timestamp: $TIMESTAMP"
echo "  Body: ${BODY:0:80}..."
echo ""

# Generate signature
SIG_BASESTRING="v0:${TIMESTAMP}:${BODY}"
SIGNATURE="v0=$(echo -n "$SIG_BASESTRING" | openssl dgst -sha256 -hmac "$SIGNING_SECRET" | awk '{print $2}')"

echo "Generated signature: ${SIGNATURE:0:30}..."
echo ""

# Make request
echo "Sending request to: ${API_GATEWAY_URL}"
echo ""

# Use --data-raw to prevent curl from encoding the body
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "${API_GATEWAY_URL}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "X-Slack-Request-Timestamp: ${TIMESTAMP}" \
  -H "X-Slack-Signature: ${SIGNATURE}" \
  --data-raw "$BODY")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY_RESPONSE=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d')

echo "========================================"
echo "Response:"
echo "========================================"
echo "Status: $HTTP_STATUS"
echo "Body: $BODY_RESPONSE"
echo ""

if [ "$HTTP_STATUS" == "200" ]; then
  echo "✓ SUCCESS - Signature validation passed!"
  exit 0
elif [ "$HTTP_STATUS" == "401" ] || [ "$HTTP_STATUS" == "403" ]; then
  echo "✗ FAILED - Signature validation failed (401/403)"
  echo ""
  echo "Debugging info:"
  echo "  - Check that signing secret is correct in SSM"
  echo "  - Verify timestamp is not too old (within 5 minutes)"
  echo "  - Ensure body format matches exactly what Lambda expects"
  exit 1
else
  echo "✗ FAILED - Unexpected status code: $HTTP_STATUS"
  exit 1
fi
