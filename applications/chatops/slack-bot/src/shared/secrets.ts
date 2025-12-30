// Secret management - runtime retrieval from Parameter Store

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { logger } from './logger';
import { config } from './config';

const ssmClient = new SSMClient({
  region: config.get().awsRegion,
  ...(process.env.AWS_ENDPOINT_URL && {
    endpoint: process.env.AWS_ENDPOINT_URL
  })
});

const secretCache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getSecret(secretName: string): Promise<string> {
  // Check cache first
  const cached = secretCache.get(secretName);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug('Secret retrieved from cache', { secretName });
    return cached.value;
  }

  // For local development, use environment variables
  if (config.get().isLocal) {
    const envVarName = secretName.toUpperCase().replace(/[/-]/g, '_');
    const value = process.env[envVarName];
    if (value) {
      logger.debug('Secret retrieved from environment', { secretName, envVarName });
      return value;
    }
  }

  // Fetch from Parameter Store
  const parameterPath = config.getParameterPath(secretName);

  try {
    logger.debug('Fetching secret from Parameter Store', { parameterPath });

    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterPath,
        WithDecryption: true
      })
    );

    const value = response.Parameter?.Value;
    if (!value) {
      throw new Error(`Secret not found: ${parameterPath}`);
    }

    // Cache the secret
    secretCache.set(secretName, {
      value,
      expiresAt: Date.now() + CACHE_TTL
    });

    logger.info('Secret retrieved successfully', { secretName });
    return value;
  } catch (error) {
    logger.error('Failed to retrieve secret', error as Error, { secretName, parameterPath });
    throw error;
  }
}

export async function getSlackBotToken(): Promise<string> {
  return getSecret('slack/bot-token');
}

export async function getSlackSigningSecret(): Promise<string> {
  return getSecret('slack/signing-secret');
}

export async function getGitHubToken(): Promise<string> {
  // For local development, use environment variable
  if (config.get().isLocal) {
    const value = process.env.GITHUB_PAT_CLOUD_APPS;
    if (value) {
      logger.debug('GitHub PAT retrieved from environment');
      return value;
    }
  }

  // GitHub PAT is stored in common environment, not environment-specific
  // Use direct parameter path instead of getSecret() which adds environment prefix
  const parameterPath = '/laco/cmn/github/pat/cloud-apps';

  try {
    logger.debug('Fetching GitHub PAT from Parameter Store', { parameterPath });

    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: parameterPath,
        WithDecryption: true
      })
    );

    const value = response.Parameter?.Value;
    if (!value) {
      throw new Error(`GitHub PAT not found: ${parameterPath}`);
    }

    logger.info('GitHub PAT retrieved successfully');
    return value;
  } catch (error) {
    logger.error('Failed to retrieve GitHub PAT', error as Error, { parameterPath });
    throw error;
  }
}
