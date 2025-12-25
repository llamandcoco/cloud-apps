// Unit tests for Router Lambda

import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../src/router';
import * as secrets from '../../src/shared/secrets';
import * as slackVerify from '../../src/shared/slack-verify';

// Mock AWS SDK
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('../../src/shared/secrets');
jest.mock('../../src/shared/slack-verify');

describe('Router Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVENTBRIDGE_BUS_NAME = 'test-bus';
  });

  const createEvent = (body: string): APIGatewayProxyEvent => ({
    body,
    headers: {
      'x-slack-request-timestamp': '1234567890',
      'x-slack-signature': 'v0=test-signature'
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
  });

  test('should return 401 for invalid signature', async () => {
    jest.spyOn(secrets, 'getSlackSigningSecret').mockResolvedValue('secret');
    jest.spyOn(slackVerify, 'verifySlackSignature').mockResolvedValue(false);

    const event = createEvent('command=/echo&text=test');
    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('Invalid signature');
  });

  test('should return 200 and publish to EventBridge for valid request', async () => {
    jest.spyOn(secrets, 'getSlackSigningSecret').mockResolvedValue('secret');
    jest.spyOn(slackVerify, 'verifySlackSignature').mockResolvedValue(true);

    const body = 'command=/echo&text=hello&response_url=https://test.com&user_id=U123&user_name=testuser&channel_id=C123&channel_name=general&team_id=T123&team_domain=test&trigger_id=123';
    const event = createEvent(body);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const response = JSON.parse(result.body);
    expect(response.text).toContain('Processing');
    expect(response.response_type).toBe('ephemeral');
  });

  test('should handle errors gracefully', async () => {
    jest.spyOn(secrets, 'getSlackSigningSecret').mockRejectedValue(new Error('Secret not found'));

    const event = createEvent('command=/echo&text=test');
    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).text).toContain('something went wrong');
  });
});
