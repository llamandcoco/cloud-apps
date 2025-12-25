// Status Worker Lambda - Reports system status

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { WorkerMessage } from '../../shared/types';

interface ServiceStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  latency?: number;
  message?: string;
}

async function checkServiceStatus(serviceName: string): Promise<ServiceStatus> {
  // Simulate health check
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 500));

  const isHealthy = Math.random() > 0.1; // 90% success rate

  return {
    name: serviceName,
    status: isHealthy ? 'healthy' : 'degraded',
    latency: Math.round(50 + Math.random() * 200),
    message: isHealthy ? 'All systems operational' : 'Experiencing delays'
  };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  logger.info('Status worker invoked', {
    recordCount: event.Records.length
  });

  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const message: WorkerMessage = JSON.parse(record.body);

      logger.info('Processing status command', {
        user: message.user_name
      });

      // Send initial response
      await sendSlackResponse(message.response_url, {
        response_type: 'ephemeral',
        text: 'Checking system status...'
      });

      // Check various services
      const services = [
        'API Gateway',
        'Lambda Functions',
        'EventBridge',
        'SQS Queues',
        'Parameter Store'
      ];

      const statuses = await Promise.all(
        services.map(service => checkServiceStatus(service))
      );

      // Generate status report
      const allHealthy = statuses.every(s => s.status === 'healthy');
      const overallStatus = allHealthy ? '✅ All Systems Operational' : '⚠️ Some Services Degraded';

      const statusBlocks = statuses.map(s => {
        const icon = s.status === 'healthy' ? '✅' : '⚠️';
        return `${icon} *${s.name}*: ${s.status} (${s.latency}ms)`;
      }).join('\n');

      await sendSlackResponse(message.response_url, {
        response_type: 'in_channel',
        text: overallStatus,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '📊 System Status Report'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: statusBlocks
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Overall Status:* ${overallStatus}`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Requested by <@${message.user_id}> | ${new Date().toISOString()}`
              }
            ]
          }
        ]
      });

      logger.info('Status report sent');
    } catch (error) {
      logger.error('Failed to process status command', error as Error, {
        messageId: record.messageId
      });

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
