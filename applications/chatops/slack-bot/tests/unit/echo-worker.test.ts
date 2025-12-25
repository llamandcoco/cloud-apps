// Unit tests for Echo Worker

import { SQSEvent } from 'aws-lambda';
import { handler } from '../../src/workers/echo';
import * as slackClient from '../../src/shared/slack-client';

jest.mock('../../src/shared/slack-client');

describe('Echo Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createSQSEvent = (body: string): SQSEvent => ({
    Records: [
      {
        messageId: 'test-message-id',
        receiptHandle: 'test-receipt',
        body,
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '1234567890',
          SenderId: 'test-sender',
          ApproximateFirstReceiveTimestamp: '1234567890'
        },
        messageAttributes: {},
        md5OfBody: 'test-md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:region:account:queue',
        awsRegion: 'ca-central-1'
      }
    ]
  });

  test('should send sync and async responses', async () => {
    const sendMock = jest.spyOn(slackClient, 'sendSlackResponse').mockResolvedValue();

    const message = {
      command: '/echo',
      text: 'hello world',
      response_url: 'https://hooks.slack.com/test',
      user_id: 'U123',
      user_name: 'testuser',
      channel_id: 'C123'
    };

    const event = createSQSEvent(JSON.stringify(message));
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(sendMock).toHaveBeenCalledTimes(2);

    // Check sync response
    expect(sendMock).toHaveBeenNthCalledWith(1, message.response_url, {
      response_type: 'in_channel',
      text: 'sync hello world'
    });

    // Check async response
    expect(sendMock).toHaveBeenNthCalledWith(2, message.response_url, expect.objectContaining({
      response_type: 'in_channel',
      text: 'async hello world'
    }));
  });

  test('should handle errors and return failed items', async () => {
    jest.spyOn(slackClient, 'sendSlackResponse').mockRejectedValue(new Error('Network error'));

    const message = {
      command: '/echo',
      text: 'test',
      response_url: 'https://hooks.slack.com/test',
      user_id: 'U123',
      user_name: 'testuser',
      channel_id: 'C123'
    };

    const event = createSQSEvent(JSON.stringify(message));
    const result = await handler(event);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
  });
});
