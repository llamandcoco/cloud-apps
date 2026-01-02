// Test signature generation locally
const crypto = require('crypto');

// Simulated signing secret (replace with actual for testing)
const signingSecret = 'test-secret-replace-with-real';

// Simulate Artillery request
const timestamp = Math.floor(Date.now() / 1000);
const body = "token=test&team_id=T123&team_domain=test&channel_id=C123&channel_name=general&user_id=U1234&user_name=testuser1&command=/echo&text=performance test message 12345&response_url=https://hooks.slack.com/commands/T123/456/token&trigger_id=123.456.abc";

console.log('='.repeat(60));
console.log('Testing Slack Signature Generation');
console.log('='.repeat(60));
console.log('\n1. Request Details:');
console.log('   Timestamp:', timestamp);
console.log('   Body length:', body.length);
console.log('   Body:', body.substring(0, 100) + '...');

// Generate signature
const sigBasestring = `v0:${timestamp}:${body}`;
console.log('\n2. Signature Base String:');
console.log('   ', sigBasestring.substring(0, 100) + '...');

const signature = 'v0=' + crypto
  .createHmac('sha256', signingSecret)
  .update(sigBasestring)
  .digest('hex');

console.log('\n3. Generated Signature:');
console.log('   ', signature);

console.log('\n4. Headers to send:');
console.log('   X-Slack-Request-Timestamp:', timestamp);
console.log('   X-Slack-Signature:', signature);

console.log('\n5. Test with curl:');
console.log(`
curl -X POST https://YOUR_API_GATEWAY_URL/slack \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -H "X-Slack-Request-Timestamp: ${timestamp}" \\
  -H "X-Slack-Signature: ${signature}" \\
  -d '${body}'
`);

console.log('\n' + '='.repeat(60));
console.log('Note: Replace signingSecret with actual secret from SSM');
console.log('='.repeat(60));
