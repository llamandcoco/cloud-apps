// Response Cache Manager for Read-only Operations
// Caches API responses to reduce external API calls and improve performance

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from './logger';
import { getConfig } from './config';

const client = new DynamoDBClient({ region: 'ca-central-1' });
const docClient = DynamoDBDocumentClient.from(client);

interface CacheEntry<T = any> {
  cacheKey: string;
  response: T;
  createdAt: string;
  ttl: number;
  hitCount?: number;
  lastAccessedAt?: string;
  cacheStrategy?: 'request-dedup' | 'response-cache' | 'data-cache';
}

interface CacheOptions {
  ttlSeconds: number;
  strategy?: 'request-dedup' | 'response-cache' | 'data-cache';
  updateHitCount?: boolean;
}

export class ResponseCacheManager {
  private tableName: string;

  constructor() {
    const config = getConfig();
    this.tableName = `${config.orgPrefix}-${config.environment}-chatbot-response-cache`;
  }

  /**
   * Get cached response
   * Returns null if cache miss or expired
   */
  async get<T = any>(cacheKey: string, options?: { updateHitCount?: boolean }): Promise<T | null> {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { cacheKey },
        })
      );

      if (!result.Item) {
        logger.debug('Cache miss', { cacheKey });
        return null;
      }

      const entry = result.Item as CacheEntry<T>;

      // Check if cache is expired (DynamoDB TTL is async, so explicit check)
      const now = Math.floor(Date.now() / 1000);
      if (entry.ttl < now) {
        logger.debug('Cache expired', { cacheKey, ttl: entry.ttl, now });
        return null;
      }

      // Calculate age
      const ageMs = Date.now() - new Date(entry.createdAt).getTime();
      const ageSec = Math.floor(ageMs / 1000);

      logger.info('Cache hit', {
        cacheKey,
        age: ageSec,
        strategy: entry.cacheStrategy,
        hitCount: entry.hitCount,
      });

      // Update hit count asynchronously (fire-and-forget)
      if (options?.updateHitCount !== false) {
        this.incrementHitCount(cacheKey).catch((error) => {
          logger.warn('Failed to update hit count', { cacheKey, error });
        });
      }

      return entry.response;
    } catch (error) {
      logger.error('Cache get error', error as Error, { cacheKey });
      // On error, treat as cache miss (fail open)
      return null;
    }
  }

  /**
   * Store response in cache
   */
  async set<T = any>(
    cacheKey: string,
    response: T,
    options: CacheOptions
  ): Promise<void> {
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + options.ttlSeconds;

    const entry: CacheEntry<T> = {
      cacheKey,
      response,
      createdAt: now.toISOString(),
      ttl,
      hitCount: 0,
      lastAccessedAt: now.toISOString(),
      cacheStrategy: options.strategy || 'response-cache',
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: entry,
        })
      );

      logger.info('Cache set', {
        cacheKey,
        ttl: options.ttlSeconds,
        strategy: options.strategy,
      });
    } catch (error) {
      logger.error('Cache set error', error as Error, { cacheKey });
      // Don't throw - cache write failure shouldn't break the request
    }
  }

  /**
   * Get or compute cached value
   * If cache miss, execute computeFn and cache the result
   */
  async getOrCompute<T = any>(
    cacheKey: string,
    computeFn: () => Promise<T>,
    options: CacheOptions
  ): Promise<{ value: T; fromCache: boolean }> {
    // Try cache first
    const cached = await this.get<T>(cacheKey, { updateHitCount: true });
    if (cached !== null) {
      return { value: cached, fromCache: true };
    }

    // Cache miss - compute value
    logger.info('Cache miss - computing value', { cacheKey });

    const value = await computeFn();

    // Store in cache (fire-and-forget)
    this.set(cacheKey, value, options).catch((error) => {
      logger.warn('Failed to cache computed value', { cacheKey, error });
    });

    return { value, fromCache: false };
  }

  /**
   * Invalidate (delete) cache entry
   */
  async invalidate(cacheKey: string): Promise<void> {
    try {
      // Set TTL to immediate expiration
      const now = Math.floor(Date.now() / 1000);

      await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { cacheKey },
          UpdateExpression: 'SET #ttl = :ttl',
          ExpressionAttributeNames: {
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: {
            ':ttl': now - 1, // Already expired
          },
        })
      );

      logger.info('Cache invalidated', { cacheKey });
    } catch (error) {
      logger.error('Cache invalidation error', error as Error, { cacheKey });
    }
  }

  /**
   * Invalidate multiple cache entries by pattern
   * WARNING: This requires scanning the table - use sparingly
   */
  async invalidatePattern(pattern: RegExp): Promise<number> {
    logger.warn('Pattern-based cache invalidation not implemented', { pattern: pattern.toString() });
    // TODO: Implement with DynamoDB Scan if needed
    // For now, rely on TTL for cache expiration
    return 0;
  }

  /**
   * Increment hit count for analytics
   * Async operation - failures are logged but not thrown
   */
  private async incrementHitCount(cacheKey: string): Promise<void> {
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { cacheKey },
          UpdateExpression:
            'SET hitCount = if_not_exists(hitCount, :zero) + :one, lastAccessedAt = :now',
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':now': new Date().toISOString(),
          },
        })
      );
    } catch (error) {
      // Log but don't throw - hit count is non-critical
      logger.debug('Failed to increment hit count', { cacheKey, error });
    }
  }

  /**
   * Check if cache entry exists and is valid
   */
  async exists(cacheKey: string): Promise<boolean> {
    const entry = await this.get(cacheKey, { updateHitCount: false });
    return entry !== null;
  }

  /**
   * Generate cache key from components
   */
  static generateKey(...parts: string[]): string {
    return parts.filter(Boolean).join('-');
  }
}

// Singleton instance
export const responseCacheManager = new ResponseCacheManager();

// Helper function for common use case
export async function withCache<T>(
  cacheKey: string,
  computeFn: () => Promise<T>,
  ttlSeconds: number,
  strategy?: 'request-dedup' | 'response-cache' | 'data-cache'
): Promise<{ value: T; fromCache: boolean }> {
  return responseCacheManager.getOrCompute(cacheKey, computeFn, {
    ttlSeconds,
    strategy,
  });
}
