import { ECSClient, DescribeServicesCommand } from '@aws-sdk/client-ecs';
import { LambdaClient, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, GetMetricDataCommand, MetricDataResult } from '@aws-sdk/client-cloudwatch';
import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { SlackBlock, WorkerMessage } from '../../shared/types';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { config } from '../../shared/config';

const DEFAULT_ENVIRONMENT = 'plt';
const DEFAULT_APPLICATION = 'slack-bot';
const REGION = config.get().awsRegion || 'ca-central-1';

const ecsClient = new ECSClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });
const cloudwatchClient = new CloudWatchClient({ region: REGION });
const taggingClient = new ResourceGroupsTaggingAPIClient({ region: REGION });

const RESOURCE_TYPE_FILTERS = ['ecs:service', 'lambda', 'dynamodb:table'];

type ResourceCategory = 'ECS' | 'Lambda' | 'DynamoDB';

interface StatusQuery {
  environment: string;
  application: string;
  targets?: string[];
}

interface ResourceSummary {
  resourceType: ResourceCategory;
  name: string;
  status: string;
  metricName?: string;
  metricValue?: number;
  metricUnit?: string;
  details?: string;
}

interface MetricResult {
  value: number;
  unit?: string;
}

interface ResourceTagTarget {
  arn: string;
  type: ResourceCategory;
}

interface HandlerResult {
  syncResponseMs?: number;
  asyncResponseMs?: number;
}

function parseStatusArguments(text: string): StatusQuery {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const query: StatusQuery = {
    environment: DEFAULT_ENVIRONMENT,
    application: DEFAULT_APPLICATION,
  };

  for (const token of tokens) {
    const [rawKey, rawValue] = token.split('=');
    if (!rawKey || !rawValue) {
      continue;
    }

    const key = rawKey.toLowerCase();
    const value = rawValue.trim();
    if (!value) {
      continue;
    }

    if (key === 'env' || key === 'environment') {
      query.environment = value;
    } else if (key === 'app' || key === 'application') {
      query.application = value;
    } else if (key === 'target') {
      const targets = value.split(',').map((item) => item.trim()).filter(Boolean);
      query.targets = targets;
    }
  }

  return query;
}

function detectResourceType(arn: string): ResourceCategory | undefined {
  if (arn.includes(':service/') && arn.includes(':ecs:')) {
    return 'ECS';
  }

  if (arn.includes(':function:')) {
    return 'Lambda';
  }

  if (arn.includes(':table/')) {
    return 'DynamoDB';
  }

  return undefined;
}

function parseEcsNamesFromArn(arn: string): { cluster: string; service: string } | undefined {
  const payload = arn.split(':service/')[1];
  if (!payload) {
    return undefined;
  }

  const [cluster, service] = payload.split('/');
  if (!cluster || !service) {
    return undefined;
  }

  return { cluster, service };
}

function parseLambdaNameFromArn(arn: string): string | undefined {
  return arn.split(':function:')[1];
}

function parseTableNameFromArn(arn: string): string | undefined {
  const marker = ':table/';
  const idx = arn.indexOf(marker);
  if (idx === -1) {
    return undefined;
  }

  return arn.slice(idx + marker.length);
}

async function fetchTaggedResources(query: StatusQuery): Promise<ResourceTagTarget[]> {
  const filters = [
    { Key: 'Environment', Values: [query.environment] },
    { Key: 'Application', Values: [query.application] },
  ];

  const targets: ResourceTagTarget[] = [];
  let paginationToken: string | undefined;

  do {
    const command = new GetResourcesCommand({
      TagFilters: filters,
      ResourceTypeFilters: RESOURCE_TYPE_FILTERS,
      PaginationToken: paginationToken,
    });

    const response = await taggingClient.send(command);
    const mappings = response.ResourceTagMappingList ?? [];

    for (const mapping of mappings) {
      if (!mapping.ResourceARN) {
        continue;
      }

      const type = detectResourceType(mapping.ResourceARN);
      if (!type) {
        continue;
      }

      targets.push({ arn: mapping.ResourceARN, type });
    }

    paginationToken = response.PaginationToken;
  } while (paginationToken);

  return targets;
}

async function getLatestMetric(
  namespace: string,
  metricName: string,
  dimensions: { Name: string; Value: string }[]
): Promise<MetricResult | undefined> {
  try {
    const now = new Date();
    const start = new Date(now.getTime() - 5 * 60 * 1000);
    const metricId = `m${Date.now() % 1000}`;

    const response = await cloudwatchClient.send(
      new GetMetricDataCommand({
        StartTime: start,
        EndTime: now,
        ScanBy: 'TimestampDescending',
        MaxDatapoints: 1,
        MetricDataQueries: [
          {
            Id: metricId,
            MetricStat: {
              Metric: {
                Namespace: namespace,
                MetricName: metricName,
                Dimensions: dimensions,
              },
              Period: 60,
              Stat: 'Average',
            },
            ReturnData: true,
          },
        ],
      })
    );

    const metricResult = response.MetricDataResults?.find(
      (result: MetricDataResult) => result.Id === metricId
    );
    const value = metricResult?.Values?.[0];
    if (value === undefined) {
      return undefined;
    }

    return {
      value,
      unit: metricResult?.Label,
    };
  } catch (error) {
    logger.warn('CloudWatch metric lookup failed', {
      error: (error as Error).message,
      namespace,
      metricName,
      dimensions,
    });
    return undefined;
  }
}

async function summarizeEcsService(arn: string): Promise<ResourceSummary | undefined> {
  const names = parseEcsNamesFromArn(arn);
  if (!names) {
    return undefined;
  }

  const response = await ecsClient.send(
    new DescribeServicesCommand({
      cluster: names.cluster,
      services: [names.service],
    })
  );

  const service = response.services?.[0];
  if (!service) {
    return undefined;
  }

  const metric = await getLatestMetric('AWS/ECS', 'CPUUtilization', [
    { Name: 'ServiceName', Value: names.service },
    { Name: 'ClusterName', Value: names.cluster },
  ]);

  const statusText = service.runningCount && service.runningCount > 0 ? 'UP' : 'DOWN';

  return {
    resourceType: 'ECS',
    name: names.service,
    status: `${statusText} (${service.desiredCount ?? 0} desired / ${service.runningCount ?? 0} running)`,
    metricName: 'CPUUtilization',
    metricValue: metric?.value,
    metricUnit: metric?.unit,
    details: service.status,
  };
}

async function summarizeLambdaFunction(arn: string): Promise<ResourceSummary | undefined> {
  const functionName = parseLambdaNameFromArn(arn);
  if (!functionName) {
    return undefined;
  }

  const response = await lambdaClient.send(
    new GetFunctionConfigurationCommand({
      FunctionName: functionName,
    })
  );

  const metric = await getLatestMetric('AWS/Lambda', 'Errors', [{ Name: 'FunctionName', Value: functionName }]);

  return {
    resourceType: 'Lambda',
    name: functionName,
    status: `${response.State ?? 'UNKNOWN'} / ${response.LastUpdateStatus ?? 'UNKNOWN'}`,
    metricName: 'Errors',
    metricValue: metric?.value,
    metricUnit: metric?.unit,
    details: response.LastUpdateStatusReason,
  };
}

async function summarizeDynamoDbTable(arn: string): Promise<ResourceSummary | undefined> {
  const tableName = parseTableNameFromArn(arn);
  if (!tableName) {
    return undefined;
  }

  const response = await dynamoClient.send(
    new DescribeTableCommand({
      TableName: tableName,
    })
  );

  const metric = await getLatestMetric('AWS/DynamoDB', 'ConsumedReadCapacityUnits', [
    { Name: 'TableName', Value: tableName },
  ]);

  return {
    resourceType: 'DynamoDB',
    name: tableName,
    status: response.Table?.TableStatus ?? 'UNKNOWN',
    metricName: 'ConsumedReadCapacityUnits',
    metricValue: metric?.value,
    metricUnit: metric?.unit,
  };
}

async function buildResourceSummaries(query: StatusQuery): Promise<ResourceSummary[]> {
  const taggedResources = await fetchTaggedResources(query);
  const summaries: ResourceSummary[] = [];

  for (const resource of taggedResources) {
    try {
      if (resource.type === 'ECS') {
        const summary = await summarizeEcsService(resource.arn);
        if (summary) {
          summaries.push(summary);
        }
      } else if (resource.type === 'Lambda') {
        const summary = await summarizeLambdaFunction(resource.arn);
        if (summary) {
          summaries.push(summary);
        }
      } else if (resource.type === 'DynamoDB') {
        const summary = await summarizeDynamoDbTable(resource.arn);
        if (summary) {
          summaries.push(summary);
        }
      }
    } catch (error) {
      logger.warn('Failed to summarize resource', {
        error: (error as Error).message,
        arn: resource.arn,
        type: resource.type,
      });
    }
  }

  return summaries;
}

function formatTableRows(summaries: ResourceSummary[]): string[] {
  const header = ['| Resource | Type | Status | Metric | Value |'];
  const divider = ['| --- | --- | --- | --- | --- |'];
  const rows = summaries.map((summary) => {
    const metricValue = summary.metricValue !== undefined
      ? `${summary.metricValue.toFixed(2)}${summary.metricUnit ? ` ${summary.metricUnit}` : ''}`
      : 'n/a';
    const metricLabel = summary.metricName ?? 'n/a';
    return `| ${summary.name} | ${summary.resourceType} | ${summary.status} | ${metricLabel} | ${metricValue} |`;
  });

  return [...header, ...divider, ...rows];
}

export async function handleStatus(message: WorkerMessage, messageId: string): Promise<HandlerResult> {
  const startTime = Date.now();
  const statusLogger = logger.child(message.correlation_id || messageId, {
    component: 'status-handler',
    command: message.command,
    userId: message.user_id,
  });

  const query = parseStatusArguments(message.text);
  statusLogger.info('Status command parameters', { ...query });

  let syncResponseMs: number | undefined;

  try {
    const summaries = await buildResourceSummaries(query);
    const targetFilters = query.targets?.map((target) => target.toLowerCase()) ?? [];

    const filteredSummaries = targetFilters.length
      ? summaries.filter((summary) =>
        targetFilters.some((target) => summary.name.toLowerCase().includes(target))
      )
      : summaries;

    const tableRows = filteredSummaries.length ? formatTableRows(filteredSummaries) : [];

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📋 *Status report*\nEnvironment: \`${query.environment}\`\nApplication: \`${query.application}\`${
            targetFilters.length ? `\nTargets: \`${targetFilters.join(', ')}\`` : ''
          }`,
        },
      },
    ];

    if (tableRows.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`\`\`\n${tableRows.join('\n')}\n\`\`\``,
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⚠️ No tagged resources matched the provided filters. Verify the environment/application tags or add the services to the tag group.',
        },
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Latest metrics based on CloudWatch (last 5 minutes).',
        },
      ],
    });

    const responseStart = Date.now();
    await sendSlackResponse(message.response_url, {
      response_type: 'in_channel',
      text: `📊 Status report for ${query.environment}/${query.application}`,
      blocks,
    });
    syncResponseMs = Date.now() - responseStart;

    statusLogger.info('Status command processed', {
      duration: Date.now() - startTime,
      resourceCount: summaries.length,
      rowsReturned: filteredSummaries.length,
    });

    return { syncResponseMs };
  } catch (error) {
    statusLogger.error('Failed to process status command', error as Error, {
      duration: Date.now() - startTime,
    });

    await sendSlackResponse(message.response_url, {
      response_type: 'in_channel',
      text: `❌ Failed to gather status: ${(error as Error).message}`,
    });

    throw error;
  }
}
