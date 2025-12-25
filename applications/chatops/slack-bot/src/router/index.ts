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

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  logger.info('Router Lambda invoked', {
    path: event.path,
    httpMethod: event.httpMethod
  });

  try {
    // 1. Verify Slack signature
    const signingSecret = await getSlackSigningSecret();
    const isValid = await verifySlackSignature(
      signingSecret,
      {
        'x-slack-request-timestamp': event.headers['x-slack-request-timestamp'] || event.headers['X-Slack-Request-Timestamp'] || '',
        'x-slack-signature': event.headers['x-slack-signature'] || event.headers['X-Slack-Signature'] || ''
      },
      event.body || ''
    );

    if (!isValid) {
      logger.warn('Invalid Slack signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    // 2. Parse Slack command
    const params = parseSlackCommand(event.body || '');
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
      trigger_id: params.trigger_id || ''
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
    logger.error('Router Lambda error', error as Error);

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
