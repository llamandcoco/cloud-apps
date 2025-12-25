/**
 * Integration test: EventBridge → SQS → Echo Worker
 * 
 * Tests end-to-end flow:
 * 1. Publish event to EventBridge
 * 2. EventBridge rule routes to SQS
 * 3. Lambda receives SQS message
 * 4. Lambda sends response via mocked Slack API
 */

import { handler as echoWorkerHandler } from '../../src/workers/echo';
import { SQSEvent } from 'aws-lambda';
import axios from 'axios';

// Mock axios for Slack API calls
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EventBridge → Worker Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
  });

  test('should process echo command and send sync + async responses', async () => {
    const sqsEvent: SQSEvent = {
      Records: [
        {
          messageId: 'msg-123',
          receiptHandle: 'receipt-123',
          body: JSON.stringify({
            command: '/echo',
            text: 'hello world',
            response_url: 'https://hooks.slack.com/commands/T123/B123/XXXX',
            user_id: 'U123',
            user_name: 'testuser',
            channel_id: 'C123',
            channel_name: 'general',
            team_id: 'T123',
            team_domain: 'test',
            trigger_id: 'trigger-123'
          }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: Date.now().toString(),
            SenderId: 'sender-123',
            ApproximateFirstReceiveTimestamp: Date.now().toString()
          },
          messageAttributes: {}
        }
      ]
    };

    const result = await echoWorkerHandler(sqsEvent);

    // Should succeed
    expect(result.batchItemFailures).toHaveLength(0);

    // Should call Slack API twice (sync + async)
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);

    // First call: sync response
    const [syncUrl, syncPayload] = mockedAxios.post.mock.calls[0];
    expect(syncUrl).toBe('https://hooks.slack.com/commands/T123/B123/XXXX');
    expect(syncPayload).toHaveProperty('response_type', 'in_channel');
    expect(syncPayload.text).toBe('sync hello world');

    // Second call: async response (after delay)
    const [asyncUrl, asyncPayload] = mockedAxios.post.mock.calls[1];
    expect(asyncUrl).toBe('https://hooks.slack.com/commands/T123/B123/XXXX');
    expect(asyncPayload).toHaveProperty('response_type', 'in_channel');
    expect(asyncPayload.text).toBe('async hello world');
    expect(asyncPayload).toHaveProperty('blocks');
  }, 10000);

  test('should handle failed Slack API calls', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Network error'));

    const sqsEvent: SQSEvent = {
      Records: [
        {
          messageId: 'msg-fail',
          receiptHandle: 'receipt-fail',
          body: JSON.stringify({
            command: '/echo',
            text: 'test',
            response_url: 'https://hooks.slack.com/commands/invalid',
            user_id: 'U123',
            user_name: 'testuser',
            channel_id: 'C123',
            channel_name: 'general',
            team_id: 'T123',
            team_domain: 'test',
            trigger_id: 'trigger-123'
          }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: Date.now().toString(),
            SenderId: 'sender-123',
            ApproximateFirstReceiveTimestamp: Date.now().toString()
          },
          messageAttributes: {}
        }
      ]
    };

    const result = await echoWorkerHandler(sqsEvent);

    // Should mark message for retry
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
  });

  test('should handle malformed SQS message', async () => {
    const sqsEvent: SQSEvent = {
      Records: [
        {
          messageId: 'msg-bad',
          receiptHandle: 'receipt-bad',
          body: 'invalid json',
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: Date.now().toString(),
            SenderId: 'sender-123',
            ApproximateFirstReceiveTimestamp: Date.now().toString()
          },
          messageAttributes: {}
        }
      ]
    };

    const result = await echoWorkerHandler(sqsEvent);

    // Should mark for retry
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-bad');

    // Should not call Slack API
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
