// Unit tests for Slack signature verification

import { verifySlackSignature } from '../../src/shared/slack-verify';
import * as crypto from 'crypto';

describe('Slack Signature Verification', () => {
  const signingSecret = 'test-signing-secret';

  test('should verify valid signature', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = 'command=/echo&text=test';

    // Generate valid signature
    const sigBaseString = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(sigBaseString);
    const signature = `v0=${hmac.digest('hex')}`;

    const isValid = await verifySlackSignature(
      signingSecret,
      {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      },
      body
    );

    expect(isValid).toBe(true);
  });

  test('should reject invalid signature', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = 'command=/echo&text=test';

    const isValid = await verifySlackSignature(
      signingSecret,
      {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=invalid-signature'
      },
      body
    );

    expect(isValid).toBe(false);
  });

  test('should reject old timestamp (replay attack)', async () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 6+ minutes ago
    const body = 'command=/echo&text=test';

    const sigBaseString = `v0:${oldTimestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(sigBaseString);
    const signature = `v0=${hmac.digest('hex')}`;

    const isValid = await verifySlackSignature(
      signingSecret,
      {
        'x-slack-request-timestamp': oldTimestamp,
        'x-slack-signature': signature
      },
      body
    );

    expect(isValid).toBe(false);
  });

  test('should reject missing headers', async () => {
    const isValid = await verifySlackSignature(
      signingSecret,
      {
        'x-slack-request-timestamp': '',
        'x-slack-signature': ''
      },
      'test-body'
    );

    expect(isValid).toBe(false);
  });
});
