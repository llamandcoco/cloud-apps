// Scheduled deployment handler - Creates approval requests for scheduled EKS deployments

import { EventBridgeEvent } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../shared/logger';
import { createDeploymentRequest } from '../../shared/dynamodb-client';
import { createApprovalMessage } from '../../shared/slack-blocks';
import axios from 'axios';
import { getParameter } from '../../shared/secrets';

interface ScheduledDeploymentEvent {
  deployment_type: 'create_cluster' | 'delete_cluster';
  cluster_config: {
    cluster_name: string;
    environment: string;
    version?: string;
    region?: string;
  };
}

/**
 * Handle scheduled deployment events from EventBridge
 * Creates approval request in DynamoDB and sends Slack message
 */
export async function handleScheduledDeployment(
  event: EventBridgeEvent<string, ScheduledDeploymentEvent>
): Promise<void> {
  logger.info('Scheduled deployment triggered', {
    source: event.source,
    detailType: event['detail-type'],
    deployment_type: event.detail.deployment_type
  });

  const request_id = uuidv4();
  const created_at = new Date().toISOString();
  const { deployment_type, cluster_config } = event.detail;

  // Create deployment request in DynamoDB
  const deploymentRequest = {
    request_id,
    created_at,
    status: 'pending_approval' as const,
    deployment_type,
    cluster_config,
    retry_count: 0,
    max_retries: 3,
    retry_interval_minutes: 15,
    scheduled_time: created_at
  };

  await createDeploymentRequest(deploymentRequest);
  logger.info('Deployment request created', { request_id });

  // Send Slack approval message
  const slackBotToken = await getParameter('/laco/plt/aws/secrets/slack/bot-token');
  const slackChannelId = process.env.SLACK_CHANNEL_ID || 'C06XXXXXXXXX';

  const approvalMessage = createApprovalMessage(deploymentRequest);

  try {
    await axios.post('https://slack.com/api/chat.postMessage', {
      channel: slackChannelId,
      ...approvalMessage
    }, {
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info('Slack approval message sent', { request_id, channel: slackChannelId });
  } catch (error) {
    logger.error('Failed to send Slack approval message', error as Error, { request_id });
    throw error;
  }
}
