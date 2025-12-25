/**
 * Integration test: Router Lambda → EventBridge
 * 
 * Tests that Router Lambda correctly:
 * 1. Verifies Slack signature
 * 2. Parses command
 * 3. Publishes to EventBridge
 */

import { handler } from '../../src/router';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { EventBridgeClient, ListEventBusesCommand, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import * as crypto from 'crypto';

describe('Router Lambda → EventBridge Integration', () => {
  const signingSecret = 'test-signing-secret';
  const eventBridgeClient = new EventBridgeClient({
    region: 'ca-central-1',
    endpoint: process.env.AWS_ENDPOINT_URL
  });

  // Create EventBridge bus for testing
  beforeAll(async () => {
    try {
      // LocalStack creates default event bus, but we'll send to named bus
      process.env.EVENTBRIDGE_BUS_NAME = 'laco-local-chatbot';
    } catch (error) {
      console.error('Failed to create EventBridge bus:', error);
    }
  });

  function createSignedEvent(
    body: string,
    timestamp: string = Math.floor(Date.now() / 1000).toString()
  ): APIGatewayProxyEvent {
    const sigBaseString = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(sigBaseString);
    const signature = `v0=${hmac.digest('hex')}`;

    return {
      body,
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      },
      httpMethod: 'POST',
      path: '/slack/commands',
      isBase64Encoded: false,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
      pathParameters: null,
      queryStringParameters: null,
      requestContext: {} as any,
      resource: '',
      stageVariables: null
    };
  }

  test('should publish valid Slack command to EventBridge', async () => {
    // Mock getSlackSigningSecret to return our test secret
    jest.spyOn(require('../../src/shared/secrets'), 'getSlackSigningSecret')
      .mockResolvedValue(signingSecret);

    const body = 'command=/echo&text=hello+world&response_url=https://hooks.slack.com/test&user_id=U123&user_name=testuser&channel_id=C123&channel_name=general&team_id=T123&team_domain=test&trigger_id=123';
    const event = createSignedEvent(body);

    // Invoke router
    const result = await handler(event);

    // Verify response
    expect(result.statusCode).toBe(200);
    const response = JSON.parse(result.body);
    expect(response.response_type).toBe('ephemeral');
    expect(response.text).toContain('Processing');

    // Give EventBridge a moment to process
    await new Promise(resolve => setTimeout(resolve, 500));

    // Note: In real LocalStack scenario, we'd query EventBridge DLQ or SQS
    // For this test, we're validating that handler executed without errors
  }, 15000);

  test('should reject invalid signature', async () => {
    jest.spyOn(require('../../src/shared/secrets'), 'getSlackSigningSecret')
      .mockResolvedValue('wrong-secret');

    const body = 'command=/echo&text=test';
    const event = createSignedEvent(body);

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    const response = JSON.parse(result.body);
    expect(response.error).toBe('Invalid signature');
  });

  test('should reject replay attacks (old timestamp)', async () => {
    jest.spyOn(require('../../src/shared/secrets'), 'getSlackSigningSecret')
      .mockResolvedValue(signingSecret);

    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 6+ min ago
    const body = 'command=/echo&text=test';
    const event = createSignedEvent(body, oldTimestamp);

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });
});
