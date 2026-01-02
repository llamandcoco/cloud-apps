const crypto = require('crypto');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

let slackSigningSecret = null;
let isFetchingSecret = false;
let secretPromise = null;

/**
 * Fetch Slack signing secret from AWS SSM Parameter Store
 * Cached after first retrieval for performance
 */
async function getSlackSigningSecret() {
  // Return cached secret if available
  if (slackSigningSecret) {
    return slackSigningSecret;
  }

  // If already fetching, wait for that promise
  if (isFetchingSecret && secretPromise) {
    return secretPromise;
  }

  // Start fetching
  isFetchingSecret = true;
  secretPromise = (async () => {
    try {
      const environment = process.env.ENVIRONMENT || 'plt';
      const region = process.env.AWS_REGION || 'ca-central-1';
      const parameterName = `/laco/${environment}/aws/secrets/slack/signing-secret`;

      console.log(`Fetching Slack signing secret from SSM: ${parameterName}`);

      const ssm = new SSMClient({ region });
      const response = await ssm.send(new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true
      }));

      slackSigningSecret = response.Parameter.Value;
      console.log('✓ Slack signing secret retrieved successfully');
      return slackSigningSecret;
    } catch (error) {
      console.error('✗ Failed to fetch Slack signing secret from SSM:', error.message);
      console.error('  Make sure you have AWS credentials configured and access to Parameter Store');
      throw error;
    } finally {
      isFetchingSecret = false;
    }
  })();

  return secretPromise;
}

/**
 * Generate Slack request signature
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * IMPORTANT: Must be called AFTER Artillery processes templates
 * This is a workaround since Artillery evaluates templates after beforeRequest hooks
 */
function generateSlackSignature(requestParams, context, ee, next) {
  // Generate random values first (to replace Artillery templates)
  const userId = Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
  const userName = Math.floor(Math.random() * 100) + 1;
  const messageId = Math.floor(Math.random() * 100000) + 1;

  // Build body with actual values (not templates)
  const body = `token=test&team_id=T123&team_domain=test&channel_id=C123&channel_name=general&user_id=U${userId}&user_name=testuser${userName}&command=/echo&text=performance test message ${messageId}&response_url=https://hooks.slack.com/commands/T123/456/token&trigger_id=123.456.abc`;

  // Replace requestParams.body with our pre-evaluated body
  requestParams.body = body;

  const timestamp = Math.floor(Date.now() / 1000);

  getSlackSigningSecret()
    .then(secret => {
      // Create signature base string (must match exactly what Slack/Lambda expects)
      const sigBasestring = `v0:${timestamp}:${body}`;

      // Generate HMAC signature
      const signature = 'v0=' + crypto
        .createHmac('sha256', secret)
        .update(sigBasestring)
        .digest('hex');

      // Add headers to request (case-sensitive for API Gateway)
      requestParams.headers['X-Slack-Request-Timestamp'] = timestamp.toString();
      requestParams.headers['X-Slack-Signature'] = signature;

      // Debug log for first few requests
      if (context.vars.$loopCount === undefined || context.vars.$loopCount < 3) {
        console.log(`[DEBUG] Signature generated for timestamp ${timestamp}`);
        console.log(`[DEBUG] Body length: ${body.length}`);
        console.log(`[DEBUG] Body preview: ${body.substring(0, 100)}...`);
        console.log(`[DEBUG] Signature: ${signature.substring(0, 20)}...`);
      }

      return next();
    })
    .catch(err => {
      console.error('Failed to generate signature:', err);
      return next(err);
    });
}

/**
 * Capture response metrics for analysis
 */
function captureMetrics(requestParams, response, context, ee, next) {
  const statusCode = response.statusCode;
  const responseTime = response.timings.phases.total;

  // Log slow responses
  if (responseTime > 3000) {
    console.log(`⚠ Slow response: ${responseTime}ms (status: ${statusCode})`);
  }

  // Log errors
  if (statusCode >= 400) {
    console.log(`✗ Error response: ${statusCode} (time: ${responseTime}ms)`);
    if (response.body) {
      console.log(`  Body: ${response.body.substring(0, 200)}`);
    }
  }

  return next();
}

module.exports = {
  generateSlackSignature,
  captureMetrics
};
