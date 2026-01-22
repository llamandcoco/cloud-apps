import * as slackClient from '../../src/shared/slack-client';

const ecsSendMock = jest.fn();
const lambdaSendMock = jest.fn();
const dynamoSendMock = jest.fn();
const cloudwatchSendMock = jest.fn();
const taggingSendMock = jest.fn();

jest.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: jest.fn(() => ({ send: ecsSendMock })),
  DescribeServicesCommand: jest.fn((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn(() => ({ send: lambdaSendMock })),
  GetFunctionConfigurationCommand: jest.fn((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: dynamoSendMock })),
  DescribeTableCommand: jest.fn((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn(() => ({ send: cloudwatchSendMock })),
  GetMetricDataCommand: jest.fn((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-resource-groups-tagging-api', () => ({
  ResourceGroupsTaggingAPIClient: jest.fn(() => ({ send: taggingSendMock })),
  GetResourcesCommand: jest.fn((input) => ({ input })),
}));

jest.mock('../../src/shared/slack-client');

import { handleStatus } from '../../src/workers/handlers/status';
import { WorkerMessage } from '../../src/shared/types';

describe('Status handler', () => {
  const baseMessage: WorkerMessage = {
    command: '/check-status',
    text: '',
    response_url: 'https://hooks.slack.com/test',
    user_id: 'U123',
    user_name: 'testuser',
    channel_id: 'C123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('builds a status report with tagged resources', async () => {
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    const sendMock = slackClient.sendSlackResponse as jest.Mock;
    sendMock.mockResolvedValue(undefined);

    taggingSendMock
      .mockResolvedValueOnce({
        ResourceTagMappingList: [
          { ResourceARN: 'arn:aws:ecs:ca-central-1:123456789012:service/cluster-a/service-one' },
          { ResourceARN: 'arn:aws:lambda:ca-central-1:123456789012:function:lambda-func' },
          { ResourceARN: 'arn:aws:dynamodb:ca-central-1:123456789012:table/table-one' },
          { ResourceARN: 'arn:aws:s3:::example-bucket' },
          { ResourceARN: 'arn:aws:ecs:ca-central-1:123456789012:service/cluster-only' },
          { ResourceARN: undefined },
        ],
        PaginationToken: 'next',
      })
      .mockResolvedValueOnce({
        ResourceTagMappingList: [],
      });

    ecsSendMock.mockResolvedValue({
      services: [
        {
          desiredCount: 2,
          runningCount: 1,
          status: 'ACTIVE',
        },
      ],
    });

    lambdaSendMock.mockResolvedValue({
      State: 'Active',
      LastUpdateStatus: 'Successful',
      LastUpdateStatusReason: 'ok',
    });

    dynamoSendMock.mockResolvedValue({
      Table: {
        TableStatus: 'ACTIVE',
      },
    });

    cloudwatchSendMock
      .mockResolvedValueOnce({
        MetricDataResults: [
          { Id: 'm890', Values: [12.34], Label: 'Percent' },
        ],
      })
      .mockResolvedValueOnce({
        MetricDataResults: [
          { Id: 'm890', Values: [], Label: 'Count' },
        ],
      })
      .mockRejectedValueOnce(new Error('metric failed'));

    const message = {
      ...baseMessage,
      text: 'env=prod app=myapp',
    };

    await handleStatus(message, 'message-1');

    expect(taggingSendMock).toHaveBeenCalledTimes(2);
    const firstTagCommand = taggingSendMock.mock.calls[0][0];
    expect(firstTagCommand.input.TagFilters).toEqual([
      { Key: 'Environment', Values: ['prod'] },
      { Key: 'Application', Values: ['myapp'] },
    ]);

    expect(ecsSendMock).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        cluster: 'cluster-a',
        services: ['service-one'],
      },
    }));

    expect(lambdaSendMock).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        FunctionName: 'lambda-func',
      },
    }));

    expect(dynamoSendMock).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        TableName: 'table-one',
      },
    }));

    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][1];
    const blocks = payload.blocks as Array<{ text?: { text: string } }>;

    expect(payload.text).toContain('prod/myapp');
    expect(blocks[0].text?.text).toContain('Environment: `prod`');
    expect(blocks[0].text?.text).toContain('Application: `myapp`');
    expect(blocks[1].text?.text).toContain('| service-one | ECS |');
    expect(blocks[1].text?.text).toContain('| lambda-func | Lambda |');
    expect(blocks[1].text?.text).toContain('| table-one | DynamoDB |');

    dateSpy.mockRestore();
  });

  test('uses defaults and reports no matches when target filter removes all', async () => {
    const sendMock = slackClient.sendSlackResponse as jest.Mock;
    sendMock.mockResolvedValue(undefined);

    taggingSendMock.mockResolvedValueOnce({
      ResourceTagMappingList: [
        { ResourceARN: 'arn:aws:ecs:ca-central-1:123456789012:service/cluster-a/service-one' },
      ],
    });

    ecsSendMock.mockResolvedValue({
      services: [
        {
          desiredCount: 1,
          runningCount: 1,
          status: 'ACTIVE',
        },
      ],
    });

    cloudwatchSendMock.mockResolvedValue({
      MetricDataResults: [],
    });

    const message = {
      ...baseMessage,
      text: 'target=missing',
    };

    await handleStatus(message, 'message-2');

    const payload = sendMock.mock.calls[0][1];
    const blocks = payload.blocks as Array<{ text?: { text: string } }>;

    expect(blocks[0].text?.text).toContain('Environment: `plt`');
    expect(blocks[0].text?.text).toContain('Application: `slack-bot`');
    expect(blocks[0].text?.text).toContain('Targets: `missing`');
    expect(blocks[1].text?.text).toContain('No tagged resources matched');
  });

  test('sends an error response when the status lookup fails', async () => {
    const sendMock = slackClient.sendSlackResponse as jest.Mock;
    sendMock.mockResolvedValue(undefined);

    taggingSendMock.mockRejectedValue(new Error('tagging failed'));

    const message = {
      ...baseMessage,
      text: 'env=prod app=myapp',
    };

    await expect(handleStatus(message, 'message-3')).rejects.toThrow('tagging failed');

    expect(sendMock).toHaveBeenCalledWith(
      message.response_url,
      expect.objectContaining({
        text: expect.stringContaining('Failed to gather status'),
      })
    );
  });
});
