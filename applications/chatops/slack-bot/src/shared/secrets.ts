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
