/**
 * Generate Slack verification headers for a given body
 * Usage:
 *   ENVIRONMENT=local SLACK_SIGNING_SECRET=your_secret 
 *   ts-node scripts/generate-slack-headers.ts "command=/echo&text=hello"
 *
 * Prints curl-ready header flags:
 *   -H "X-Slack-Request-Timestamp: <ts>" -H "X-Slack-Signature: v0=<hex>"
 */

import crypto from 'crypto';

function main() {
  const body = process.argv[2] || '';
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!body) {
    console.error('Error: Provide URL-encoded body as first arg');
    process.exit(1);
  }
  if (!signingSecret) {
    console.error('Error: Set SLACK_SIGNING_SECRET environment variable');
    process.exit(1);
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBaseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(sigBaseString);
  const signature = `v0=${hmac.digest('hex')}`;

  // Output flags for curl
  console.log(`-H "X-Slack-Request-Timestamp: ${timestamp}" -H "X-Slack-Signature: ${signature}"`);
}

main();
