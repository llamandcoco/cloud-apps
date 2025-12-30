// Status Worker Lambda - Reports build/deploy status with caching

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import axios from 'axios';
import { logger } from '../../shared/logger';
import { sendSlackResponse } from '../../shared/slack-client';
import { WorkerMessage } from '../../shared/types';
import { ResponseCacheManager } from '../../shared/response-cache';
import { getCommandConfig } from '../../shared/command-config';
import { getGitHubToken } from '../../shared/secrets';

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface BuildStatus {
  workflows: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    created: string;
    url: string;
  }>;
  timestamp: string;
}

const cacheManager = new ResponseCacheManager();

/**
 * Fetch GitHub Actions workflow runs
 */
async function fetchGitHubWorkflowStatus(): Promise<BuildStatus> {
  const githubToken = await getGitHubToken();
  const owner = 'llamandcoco';
  const repo = 'cloud-apps';

  logger.info('Fetching GitHub workflow status', { owner, repo });

  try {
    const response = await axios.get<{ workflow_runs: WorkflowRun[] }>(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs`,
      {
        params: {
          per_page: 5,
          status: 'queued,in_progress,completed',
        },
        headers: {
          'Authorization': `token ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    const workflows = response.data.workflow_runs.map(run => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      created: run.created_at,
      url: run.html_url,
    }));

    return {
      workflows,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to fetch GitHub workflow status', error as Error);
    throw new Error(`GitHub API error: ${(error as any).response?.data?.message || (error as Error).message}`);
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  logger.info('Status worker invoked', {
    recordCount: event.Records.length
  });

  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    const startTime = Date.now();

    try {
      const message: WorkerMessage = JSON.parse(record.body);

      logger.info('Processing status command', {
        user: message.user_name
      });

      // Get command configuration for cache TTL
      const commandConfig = getCommandConfig('/status');
      const cacheTTL = commandConfig?.cacheTTL || 30;

      // Generate cache key
      const cacheKey = ResponseCacheManager.generateKey('status', 'workflows');

      // Fetch status with caching
      const { value: buildStatus, fromCache } = await cacheManager.getOrCompute(
        cacheKey,
        () => fetchGitHubWorkflowStatus(),
        {
          ttlSeconds: cacheTTL,
          strategy: 'response-cache',
        }
      );

      // Calculate cache age
      const cacheAge = fromCache
        ? Math.floor((Date.now() - new Date(buildStatus.timestamp).getTime()) / 1000)
        : 0;

      // Format workflow status
      const workflowBlocks = buildStatus.workflows.length > 0
        ? buildStatus.workflows.map(w => {
            const statusIcon = w.status === 'completed'
              ? (w.conclusion === 'success' ? '✅' : '❌')
              : '🔄';
            return `${statusIcon} <${w.url}|${w.name}>: ${w.status}${w.conclusion ? ` (${w.conclusion})` : ''}`;
          }).join('\n')
        : '_No recent workflows found_';

      // Determine overall status
      const hasRunning = buildStatus.workflows.some(w => w.status === 'in_progress' || w.status === 'queued');
      const hasFailed = buildStatus.workflows.some(w => w.conclusion === 'failure');
      const overallStatus = hasFailed
        ? '⚠️ Some builds failed'
        : hasRunning
        ? '🔄 Builds in progress'
        : '✅ All builds healthy';

      await sendSlackResponse(message.response_url, {
        response_type: 'in_channel',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '📊 Build Status Report'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Recent Workflows:*\n${workflowBlocks}`
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
                text: fromCache
                  ? `⚡ Cached ${cacheAge}s ago | Requested by <@${message.user_id}>`
                  : `🔄 Live data | Requested by <@${message.user_id}>`
              }
            ]
          }
        ]
      });

      logger.info('Status report sent', {
        duration: Date.now() - startTime,
        fromCache,
        cacheAge: fromCache ? cacheAge : null,
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Failed to process status command', error as Error, {
        messageId: record.messageId,
        duration
      });

      // Try to notify user of failure
      try {
        const message: WorkerMessage = JSON.parse(record.body);
        await sendSlackResponse(message.response_url, {
          response_type: 'ephemeral',
          text: `❌ Failed to fetch status: ${(error as Error).message}`
        });
      } catch (notifyError) {
        logger.error('Failed to send error notification', notifyError as Error);
      }

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
