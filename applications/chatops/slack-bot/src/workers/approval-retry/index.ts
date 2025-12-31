// Approval Retry Worker - Checks pending approvals and sends reminders

import { ScheduledEvent } from 'aws-lambda';
import { logger } from '../../shared/logger';
import { queryDeploymentsByStatus, incrementRetryCount, updateDeploymentStatus } from '../../shared/dynamodb-client';
import { createRetryMessage, createExpiredMessage } from '../../shared/slack-blocks';
import { getParameter } from '../../shared/secrets';
import axios from 'axios';

/**
 * Handler for scheduled retry checks
 * Runs every 15 minutes to check for pending approvals
 */
export async function handler(event: ScheduledEvent): Promise<void> {
  logger.info('Approval retry check started', {
    time: event.time,
    resources: event.resources
  });

  try {
    // Query all pending approval requests
    const pendingRequests = await queryDeploymentsByStatus('pending_approval');

    logger.info('Found pending approval requests', {
      count: pendingRequests.length
    });

    if (pendingRequests.length === 0) {
      logger.info('No pending approval requests found');
      return;
    }

    // Get Slack credentials
    const slackBotToken = await getParameter('/laco/plt/aws/secrets/slack/bot-token');
    const slackChannelId = process.env.SLACK_CHANNEL_ID || 'C06XXXXXXXXX';

    const now = Date.now();

    // Process each pending request
    for (const request of pendingRequests) {
      logger.info('Processing pending request', {
        request_id: request.request_id,
        retry_count: request.retry_count,
        max_retries: request.max_retries
      });

      // Calculate time since last retry (or creation)
      const lastRetryTime = request.last_retry_at
        ? new Date(request.last_retry_at).getTime()
        : new Date(request.created_at).getTime();

      const retryIntervalMs = request.retry_interval_minutes * 60 * 1000;
      const timeSinceLastRetry = now - lastRetryTime;

      // Check if retry interval has elapsed
      if (timeSinceLastRetry < retryIntervalMs) {
        logger.info('Retry interval not elapsed yet', {
          request_id: request.request_id,
          timeSinceLastRetry: Math.round(timeSinceLastRetry / 1000),
          retryInterval: request.retry_interval_minutes * 60
        });
        continue;
      }

      // Check if max retries exceeded
      if (request.retry_count >= request.max_retries) {
        logger.warn('Max retries exceeded, marking as expired', {
          request_id: request.request_id,
          retry_count: request.retry_count,
          max_retries: request.max_retries
        });

        // Mark as expired
        await updateDeploymentStatus(request.request_id, 'expired');

        // Send expiration message
        const expiredMessage = createExpiredMessage(request);
        await axios.post('https://slack.com/api/chat.postMessage', {
          channel: slackChannelId,
          ...expiredMessage
        }, {
          headers: {
            'Authorization': `Bearer ${slackBotToken}`,
            'Content-Type': 'application/json'
          }
        });

        logger.info('Expiration message sent', {
          request_id: request.request_id
        });
        continue;
      }

      // Increment retry count
      await incrementRetryCount(request.request_id);

      // Update request object for message
      request.retry_count += 1;

      // Send retry reminder
      const retryMessage = createRetryMessage(request);

      try {
        await axios.post('https://slack.com/api/chat.postMessage', {
          channel: slackChannelId,
          ...retryMessage
        }, {
          headers: {
            'Authorization': `Bearer ${slackBotToken}`,
            'Content-Type': 'application/json'
          }
        });

        logger.info('Retry reminder sent', {
          request_id: request.request_id,
          retry_count: request.retry_count,
          max_retries: request.max_retries
        });
      } catch (error) {
        logger.error('Failed to send retry reminder', error as Error, {
          request_id: request.request_id
        });
        // Continue processing other requests even if one fails
      }
    }

    logger.info('Approval retry check completed', {
      processed: pendingRequests.length
    });

  } catch (error) {
    logger.error('Approval retry check failed', error as Error);
    throw error;
  }
}
