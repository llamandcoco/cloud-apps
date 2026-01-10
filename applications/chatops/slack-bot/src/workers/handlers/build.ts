// Build Handler - Triggers GitHub Actions to build and upload artifacts

import axios from 'axios';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { WorkerMessage } from '../../shared/types';
import { getGitHubToken } from '../../shared/secrets';

interface BuildCommand {
  component: string;  // router, sr, lw, deploy, status, all
  environment: string; // plt, dev, prod
}

/**
 * Parse /build command
 * Examples:
 *   /build router
 *   /build sr plt
 *   /build all prod
 */
function parseBuildCommand(text: string): BuildCommand {
  const parts = text.trim().split(/\s+/);

  const component = parts[0] || 'all';
  const environment = parts[1] || 'plt';

  // Validate component
  const validComponents = ['router', 'sr', 'lw', 'deploy', 'status', 'all'];
  if (!validComponents.includes(component)) {
    throw new Error(`Invalid component: ${component}. Valid options: ${validComponents.join(', ')}`);
  }

  // Validate environment
  const validEnvs = ['plt', 'dev', 'prod'];
  if (!validEnvs.includes(environment)) {
    throw new Error(`Invalid environment: ${environment}. Valid options: ${validEnvs.join(', ')}`);
  }

  return { component, environment };
}

/**
 * Trigger GitHub Actions workflow via repository_dispatch
 */
async function triggerGitHubWorkflow(params: {
  component: string;
  environment: string;
  response_url: string;
  user: string;
}): Promise<void> {
  // Get GitHub token from Parameter Store
  const githubToken = await getGitHubToken();

  const owner = 'llamandcoco';
  const repo = 'cloud-apps';

  logger.info('Triggering GitHub Actions workflow', {
    owner,
    repo,
    component: params.component,
    environment: params.environment
  });

  try {
    const response = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/dispatches`,
      {
        event_type: 'slack-build',
        client_payload: {
          component: params.component,
          environment: params.environment,
          response_url: params.response_url,
          user: params.user,
          timestamp: new Date().toISOString()
        }
      },
      {
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.status === 204) {
      logger.info('GitHub Actions workflow triggered successfully');
    } else {
      logger.warn('Unexpected response from GitHub API', {
        status: response.status,
        data: response.data
      });
    }
  } catch (error) {
    logger.error('Failed to trigger GitHub Actions workflow', error as Error);
    throw new Error(`GitHub API error: ${(error as any).response?.data?.message || (error as Error).message}`);
  }
}

/**
 * Handle build command
 * Triggers GitHub Actions workflow to build and upload Lambda artifacts
 */
export async function handleBuild(message: WorkerMessage, messageId: string): Promise<void> {
  const startTime = Date.now();

  const messageLogger = logger.child(message.correlation_id || messageId, {
    component: 'build-handler',
    command: message.command,
    userId: message.user_id
  });

  messageLogger.info('Processing build command', {
    text: message.text,
    user: message.user_name,
    messageId
  });

  try {
    // Parse command
    const { component, environment } = parseBuildCommand(message.text);

    messageLogger.info('Parsed build command', {
      component,
      environment
    });

    // Send immediate acknowledgment
    await sendSlackResponse(message.response_url, {
      response_type: 'in_channel',
      text: `🔨 Building ${component}...`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔨 *Building ${component}*\n\nEnvironment: \`${environment}\`\nRequested by: <@${message.user_id}>\n\nTriggering GitHub Actions workflow...\nThis will take ~2 minutes`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '⏳ Build in progress...'
            }
          ]
        }
      ]
    });

    // Trigger GitHub Actions workflow
    await triggerGitHubWorkflow({
      component,
      environment,
      response_url: message.response_url,
      user: message.user_name
    });

    messageLogger.info('Build command processed successfully', {
      duration: Date.now() - startTime,
      component,
      environment
    });

  } catch (error) {
    const duration = Date.now() - startTime;

    messageLogger.error('Failed to process build command', error as Error, {
      messageId,
      duration
    });

    // Try to notify user of failure
    try {
      await sendSlackResponse(message.response_url, {
        response_type: 'in_channel',
        text: `❌ Build failed: ${(error as Error).message}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Build Failed*\n\nError: ${(error as Error).message}`
            }
          }
        ]
      });
    } catch (notifyError) {
      messageLogger.error('Failed to send error notification', notifyError as Error);
    }

    throw error;
  }
}
