// Distributed Lock Manager for Build/Deploy Operations
// Prevents duplicate builds when multiple users trigger the same command

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from './logger';
import { getConfig } from './config';

const client = new DynamoDBClient({ region: 'ca-central-1' });
const docClient = DynamoDBDocumentClient.from(client);

interface BuildLock {
  lockKey: string;
  lockedBy: string;
  lockedByName: string;
  lockedAt: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  ttl: number;
  component: string;
  environment: string;
  correlationId?: string;
}

interface LockAcquisitionResult {
  acquired: boolean;
  lockedBy?: string;
  lockedByName?: string;
  lockedAt?: string;
  existingLock?: BuildLock;
}

export class BuildLockManager {
  private tableName: string;

  constructor() {
    const config = getConfig();
    this.tableName = `${config.orgPrefix}-${config.environment}-chatbot-build-locks`;
  }

  /**
   * Generate lock key from command parameters
   */
  private generateLockKey(
    command: 'build' | 'deploy',
    component: string,
    environment: string
  ): string {
    return `${command}-${component}-${environment}`;
  }

  /**
   * Attempt to acquire a lock for a build/deploy operation
   * Returns true if lock acquired, false if already locked
   */
  async acquireLock(params: {
    command: 'build' | 'deploy';
    component: string;
    environment: string;
    userId: string;
    userName: string;
    correlationId?: string;
  }): Promise<LockAcquisitionResult> {
    const lockKey = this.generateLockKey(
      params.command,
      params.component,
      params.environment
    );

    // TTL: 10 minutes for builds, 30 minutes for deploys
    const ttlMinutes = params.command === 'build' ? 10 : 30;
    const ttl = Math.floor(Date.now() / 1000) + ttlMinutes * 60;

    const lock: BuildLock = {
      lockKey,
      lockedBy: params.userId,
      lockedByName: params.userName,
      lockedAt: new Date().toISOString(),
      status: 'IN_PROGRESS',
      ttl,
      component: params.component,
      environment: params.environment,
      correlationId: params.correlationId,
    };

    try {
      // Attempt to create lock with conditional write
      // Succeeds only if:
      // 1. Lock doesn't exist, OR
      // 2. Lock status is COMPLETED or FAILED, OR
      // 3. Lock TTL has expired
      await docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: lock,
          ConditionExpression:
            'attribute_not_exists(lockKey) OR #status IN (:completed, :failed) OR #ttl < :now',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: {
            ':completed': 'COMPLETED',
            ':failed': 'FAILED',
            ':now': Math.floor(Date.now() / 1000),
          },
        })
      );

      logger.info('Lock acquired successfully', {
        lockKey,
        userId: params.userId,
        userName: params.userName,
        ttl: ttlMinutes,
      });

      return { acquired: true };
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Lock already exists and is active
        const existingLock = await this.getLock(lockKey);

        logger.info('Lock acquisition failed - already locked', {
          lockKey,
          requestedBy: params.userId,
          lockedBy: existingLock?.lockedBy,
          lockedByName: existingLock?.lockedByName,
        });

        return {
          acquired: false,
          lockedBy: existingLock?.lockedBy,
          lockedByName: existingLock?.lockedByName,
          lockedAt: existingLock?.lockedAt,
          existingLock,
        };
      }

      // Unexpected error
      logger.error('Unexpected error acquiring lock', error);
      throw error;
    }
  }

  /**
   * Get current lock status
   */
  async getLock(lockKey: string): Promise<BuildLock | null> {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { lockKey },
        })
      );

      if (!result.Item) {
        return null;
      }

      return result.Item as BuildLock;
    } catch (error) {
      logger.error('Error getting lock', error as Error, { lockKey });
      return null;
    }
  }

  /**
   * Release lock by updating status
   */
  async releaseLock(
    command: 'build' | 'deploy',
    component: string,
    environment: string,
    status: 'COMPLETED' | 'FAILED'
  ): Promise<void> {
    const lockKey = this.generateLockKey(command, component, environment);

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { lockKey },
          UpdateExpression: 'SET #status = :status, completedAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': status,
            ':now': new Date().toISOString(),
          },
        })
      );

      logger.info('Lock released', { lockKey, status });
    } catch (error) {
      logger.error('Error releasing lock', error as Error, { lockKey, status });
      // Don't throw - lock will expire via TTL
    }
  }

  /**
   * Check if a build/deploy is currently in progress
   */
  async isLocked(
    command: 'build' | 'deploy',
    component: string,
    environment: string
  ): Promise<boolean> {
    const lockKey = this.generateLockKey(command, component, environment);
    const lock = await this.getLock(lockKey);

    if (!lock) {
      return false;
    }

    // Check if lock is expired
    const now = Math.floor(Date.now() / 1000);
    if (lock.ttl < now) {
      return false;
    }

    // Check if lock is in progress
    return lock.status === 'IN_PROGRESS';
  }
}

// Singleton instance
export const buildLockManager = new BuildLockManager();
