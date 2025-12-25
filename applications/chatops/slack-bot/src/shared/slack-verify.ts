// Slack signature verification
// https://api.slack.com/authentication/verifying-requests-from-slack

import * as crypto from 'crypto';
import { logger } from './logger';

export interface SlackRequestHeaders {
  'x-slack-request-timestamp': string;
  'x-slack-signature': string;
}

export async function verifySlackSignature(
  signingSecret: string,
  headers: SlackRequestHeaders,
  body: string
): Promise<boolean> {
  const timestamp = headers['x-slack-request-timestamp'];
  const signature = headers['x-slack-signature'];

  if (!timestamp || !signature) {
    logger.warn('Missing Slack signature headers');
    return false;
  }

  // Check timestamp to prevent replay attacks (5 minutes tolerance)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);

  if (Math.abs(currentTime - requestTime) > 300) {
    logger.warn('Slack request timestamp too old', {
      currentTime,
      requestTime,
      diff: currentTime - requestTime
    });
    return false;
  }

  // Compute expected signature
  const sigBaseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(sigBaseString);
  const expectedSignature = `v0=${hmac.digest('hex')}`;

  // Constant-time comparison to prevent timing attacks
  // Note: Buffers must be same length for timingSafeEqual
  if (signature.length !== expectedSignature.length) {
    logger.warn('Invalid Slack signature');
    return false;
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );

  if (!isValid) {
    logger.warn('Invalid Slack signature');
  }

  return isValid;
}
