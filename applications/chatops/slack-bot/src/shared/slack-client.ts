// Slack API client

import axios, { AxiosError } from 'axios';
import { SlackResponse } from './types';
import { logger } from './logger';

export async function sendSlackResponse(
  responseUrl: string,
  response: SlackResponse
): Promise<void> {
  try {
    logger.debug('Sending Slack response', { responseUrl, response });

    // Skip Slack API call for performance test mock URL
    // Performance tests use special URL to avoid 404 errors
    if (responseUrl.includes('/test/perf-test-mock')) {
      logger.info('Slack response skipped (performance test mode)', {
        responseType: response.response_type
      });
      return;
    }

    await axios.post(responseUrl, response, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000 // 5 second timeout
    });

    logger.info('Slack response sent successfully');
  } catch (error) {
    const axiosError = error as AxiosError;
    logger.error('Failed to send Slack response', axiosError, {
      responseUrl,
      status: axiosError.response?.status,
      data: axiosError.response?.data
    });
    throw error;
  }
}

export function parseSlackCommand(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    result[key] = value;
  }

  return result;
}
