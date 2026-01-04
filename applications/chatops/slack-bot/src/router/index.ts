// Router Lambda - Receives Slack commands and routes to EventBridge

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../shared/logger';
import { config } from '../shared/config';
import { verifySlackSignature } from '../shared/slack-verify';
import { parseSlackCommand } from '../shared/slack-client';
import { getSlackSigningSecret } from '../shared/secrets';
import { SlackCommand } from '../shared/types';

const appConfig = config.get();

const eventBridgeClient = new EventBridgeClient({
  region: appConfig.awsRegion,
  ...(process.env.AWS_ENDPOINT_URL && {
    endpoint: process.env.AWS_ENDPOINT_URL
  })
});

/**
 * Log router performance metrics for monitoring and analysis
 */
function logRouterMetrics(params: {
  statusCode: number;
  duration: number;
  correlationId?: string;
  command?: string;
  errorType?: string;
  errorMessage?: string;
}) {
  const { statusCode, duration, correlationId, command, errorType, errorMessage } = params;
  const success = statusCode >= 200 && statusCode < 300;

  logger.info('Router performance metrics', {
    correlationId,
    command,
    statusCode,
    duration,
    success,
    ...(errorType && { errorType }),
    ...(errorMessage && { errorMessage })
  });
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const apiGatewayStartTime = Date.now();

  logger.info('Router Lambda invoked', {
    path: event.path,
    httpMethod: event.httpMethod,
    startTime: apiGatewayStartTime
  });

  try {
    // Debug: Log request details for signature troubleshooting
    const timestamp = event.headers['x-slack-request-timestamp'] || event.headers['X-Slack-Request-Timestamp'] || '';
    const signature = event.headers['x-slack-signature'] || event.headers['X-Slack-Signature'] || '';

    logger.info('Request signature details', {
      timestamp,
      signaturePreview: signature.substring(0, 20) + '...',
      bodyLength: (event.body || '').length,
      bodyPreview: (event.body || '').substring(0, 100),
      headerKeys: Object.keys(event.headers)
    });

    // 1. Verify Slack signature
    const signingSecret = await getSlackSigningSecret();
    const isValid = await verifySlackSignature(
      signingSecret,
      {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature
      },
      event.body || ''
    );

    if (!isValid) {
      const duration = Date.now() - apiGatewayStartTime;
      logger.warn('Invalid Slack signature', {
        timestamp,
        signaturePreview: signature.substring(0, 20) + '...'
      });

      logRouterMetrics({
        statusCode: 401,
        duration,
        correlationId: timestamp,
        errorType: 'AuthenticationError',
        errorMessage: 'Invalid Slack signature'
      });

      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    // 2. Parse Slack command
    const params = parseSlackCommand(event.body || '');
    // Use Slack timestamp as correlation_id for E2E tracing
    const correlationId = timestamp || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const slackCommand: SlackCommand = {
      command: params.command || '',
      text: params.text || '',
      response_url: params.response_url || '',
      user_id: params.user_id || '',
      user_name: params.user_name || '',
      channel_id: params.channel_id || '',
      channel_name: params.channel_name || '',
      team_id: params.team_id || '',
      team_domain: params.team_domain || '',
      trigger_id: params.trigger_id || '',
      correlation_id: correlationId,
      api_gateway_start_time: apiGatewayStartTime
    };

    logger.info('Slack command received', {
      command: slackCommand.command,
      user: slackCommand.user_name,
      channel: slackCommand.channel_name
    });

    // 3. Publish to EventBridge
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'slack.command',
            DetailType: 'Slack Command',
            Detail: JSON.stringify(slackCommand),
            EventBusName: appConfig.eventBridgeBusName
          }
        ]
      })
    );

    logger.info('Event published to EventBridge', {
      command: slackCommand.command,
      eventBus: appConfig.eventBridgeBusName
    });

    // Log successful router processing metrics
    const duration = Date.now() - apiGatewayStartTime;
    logRouterMetrics({
      statusCode: 200,
      duration,
      correlationId,
      command: slackCommand.command
    });

    // 4. Return immediate acknowledgment to Slack (must respond within 3 seconds)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: `Processing your \`${slackCommand.command}\` command...`
      })
    };
  } catch (error) {
    const duration = Date.now() - apiGatewayStartTime;
    const err = error as Error;

    logger.error('Router Lambda error', err);

    logRouterMetrics({
      statusCode: 500,
      duration,
      errorType: err.name,
      errorMessage: err.message
    });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: 'Sorry, something went wrong processing your command.'
      })
    };
  }
}
