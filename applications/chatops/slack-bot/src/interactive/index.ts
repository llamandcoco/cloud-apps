// Slack Interactive Handler - Handles button clicks for deployment approval

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../shared/logger';
import { updateDeploymentStatus, getDeploymentRequest } from '../shared/dynamodb-client';
import { createApprovedMessage, createDeniedMessage } from '../shared/slack-blocks';
import { verifySlackSignature } from '../shared/slack-verify';

const eventBridge = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENTBRIDGE_BUS_NAME || 'laco-plt-chatbot';

/**
 * Main handler for Slack interactive messages (button clicks)
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Interactive handler invoked', {
      headers: event.headers,
      bodyLength: event.body?.length
    });

    // Verify Slack signature
    if (!verifySlackSignature(event)) {
      logger.warn('Invalid Slack signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    // Parse payload from form-encoded body
    const body = decodeURIComponent(event.body || '');
    const payloadMatch = body.match(/payload=(.+)/);

    if (!payloadMatch) {
      logger.error('No payload found in request');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No payload found' })
      };
    }

    const payload = JSON.parse(payloadMatch[1]);

    logger.info('Parsed payload', {
      type: payload.type,
      user: payload.user?.id,
      actions: payload.actions?.length
    });

    // Handle block actions (button clicks)
    if (payload.type === 'block_actions' && payload.actions && payload.actions.length > 0) {
      const action = payload.actions[0];
      const actionId = action.action_id;
      const requestId = action.value;
      const userId = payload.user.id;

      logger.info('Processing action', { actionId, requestId, userId });

      // Get deployment request from DynamoDB
      const deploymentRequest = await getDeploymentRequest(requestId);

      if (!deploymentRequest) {
        logger.error('Deployment request not found', { requestId });
        return {
          statusCode: 200,
          body: JSON.stringify({
            replace_original: true,
            text: `❌ Deployment request not found: ${requestId}`
          })
        };
      }

      // Handle approval
      if (actionId === 'approve_deployment') {
        logger.info('Deployment approved', { requestId, userId });

        // Update DynamoDB status
        await updateDeploymentStatus(requestId, 'approved', {
          approval_metadata: {
            approved_by: userId,
            approved_at: new Date().toISOString()
          }
        });

        // Publish event to EventBridge to trigger deployment
        await eventBridge.send(new PutEventsCommand({
          Entries: [{
            Source: 'eks.deployment',
            DetailType: 'Approval Completed',
            Detail: JSON.stringify({
              request_id: requestId,
              approved_by: userId,
              deployment_type: deploymentRequest.deployment_type,
              cluster_config: deploymentRequest.cluster_config
            }),
            EventBusName: EVENT_BUS_NAME
          }]
        }));

        logger.info('Approval event published to EventBridge', { requestId });

        // Return updated message
        const action = deploymentRequest.deployment_type === 'create_cluster' ? 'Cluster Creation' : 'Cluster Deletion';
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createApprovedMessage(userId, action))
        };
      }

      // Handle denial
      if (actionId === 'deny_deployment') {
        logger.info('Deployment denied', { requestId, userId });

        // Update DynamoDB status
        await updateDeploymentStatus(requestId, 'denied', {
          approval_metadata: {
            approved_by: userId,
            approved_at: new Date().toISOString()
          }
        });

        // Return updated message
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createDeniedMessage(userId))
        };
      }

      logger.warn('Unknown action ID', { actionId });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Unknown action' })
      };
    }

    logger.warn('Unhandled payload type', { type: payload.type });
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Unhandled payload type' })
    };

  } catch (error) {
    logger.error('Interactive handler error', error as Error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
