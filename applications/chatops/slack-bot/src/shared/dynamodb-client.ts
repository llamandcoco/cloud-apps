// DynamoDB client for EKS deployment requests

import { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { logger } from './logger';

const client = new DynamoDBClient({});

export interface DeploymentRequest {
  request_id: string;
  created_at: string;
  status: 'pending_approval' | 'approved' | 'denied' | 'in_progress' | 'completed' | 'failed' | 'expired';
  deployment_type: 'create_cluster' | 'delete_cluster';
  cluster_config: {
    cluster_name: string;
    environment: string;
    version?: string;
    region?: string;
  };
  retry_count: number;
  max_retries: number;
  retry_interval_minutes: number;
  last_retry_at?: string;
  scheduled_time: string;
  approval_metadata?: {
    approved_by: string;
    approved_at: string;
    denial_reason?: string;
  };
  execution_metadata?: {
    codebuild_id?: string;
    logs_url?: string;
    duration_seconds?: number;
  };
  expires_at: number;
}

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'laco-plt-eks-deployment-requests';

/**
 * Create a new deployment request
 */
export async function createDeploymentRequest(request: Omit<DeploymentRequest, 'expires_at'>): Promise<void> {
  const expires_at = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days TTL

  logger.info('Creating deployment request', { request_id: request.request_id });

  await client.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      request_id: { S: request.request_id },
      created_at: { S: request.created_at },
      status: { S: request.status },
      deployment_type: { S: request.deployment_type },
      cluster_config: { S: JSON.stringify(request.cluster_config) },
      retry_count: { N: String(request.retry_count) },
      max_retries: { N: String(request.max_retries) },
      retry_interval_minutes: { N: String(request.retry_interval_minutes) },
      scheduled_time: { S: request.scheduled_time },
      expires_at: { N: String(expires_at) },
      ...(request.last_retry_at && { last_retry_at: { S: request.last_retry_at } }),
      ...(request.approval_metadata && { approval_metadata: { S: JSON.stringify(request.approval_metadata) } }),
      ...(request.execution_metadata && { execution_metadata: { S: JSON.stringify(request.execution_metadata) } })
    }
  }));

  logger.info('Deployment request created successfully');
}

/**
 * Update deployment request status
 */
export async function updateDeploymentStatus(
  request_id: string,
  status: DeploymentRequest['status'],
  metadata?: Partial<DeploymentRequest>
): Promise<void> {
  logger.info('Updating deployment status', { request_id, status });

  const updateExpressions: string[] = ['#status = :status'];
  const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
  const expressionAttributeValues: Record<string, any> = { ':status': { S: status } };

  if (metadata?.approval_metadata) {
    updateExpressions.push('approval_metadata = :approval');
    expressionAttributeValues[':approval'] = { S: JSON.stringify(metadata.approval_metadata) };
  }

  if (metadata?.execution_metadata) {
    updateExpressions.push('execution_metadata = :execution');
    expressionAttributeValues[':execution'] = { S: JSON.stringify(metadata.execution_metadata) };
  }

  await client.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      request_id: { S: request_id }
    },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues
  }));

  logger.info('Deployment status updated successfully');
}

/**
 * Increment retry count
 */
export async function incrementRetryCount(request_id: string): Promise<void> {
  logger.info('Incrementing retry count', { request_id });

  await client.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      request_id: { S: request_id }
    },
    UpdateExpression: 'SET retry_count = retry_count + :inc, last_retry_at = :now',
    ExpressionAttributeValues: {
      ':inc': { N: '1' },
      ':now': { S: new Date().toISOString() }
    }
  }));
}

/**
 * Get deployment request by ID
 */
export async function getDeploymentRequest(request_id: string): Promise<DeploymentRequest | null> {
  logger.info('Getting deployment request', { request_id });

  const result = await client.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      request_id: { S: request_id }
    }
  }));

  if (!result.Item) {
    logger.warn('Deployment request not found', { request_id });
    return null;
  }

  return {
    request_id: result.Item.request_id.S!,
    created_at: result.Item.created_at.S!,
    status: result.Item.status.S as DeploymentRequest['status'],
    deployment_type: result.Item.deployment_type.S as DeploymentRequest['deployment_type'],
    cluster_config: JSON.parse(result.Item.cluster_config.S!),
    retry_count: parseInt(result.Item.retry_count.N!),
    max_retries: parseInt(result.Item.max_retries.N!),
    retry_interval_minutes: parseInt(result.Item.retry_interval_minutes.N!),
    scheduled_time: result.Item.scheduled_time.S!,
    expires_at: parseInt(result.Item.expires_at.N!),
    ...(result.Item.last_retry_at && { last_retry_at: result.Item.last_retry_at.S }),
    ...(result.Item.approval_metadata && { approval_metadata: JSON.parse(result.Item.approval_metadata.S!) }),
    ...(result.Item.execution_metadata && { execution_metadata: JSON.parse(result.Item.execution_metadata.S!) })
  };
}

/**
 * Query deployment requests by status
 */
export async function queryDeploymentsByStatus(status: DeploymentRequest['status']): Promise<DeploymentRequest[]> {
  logger.info('Querying deployments by status', { status });

  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'status-scheduled_time-index',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': { S: status }
    }
  }));

  if (!result.Items || result.Items.length === 0) {
    logger.info('No deployment requests found', { status });
    return [];
  }

  return result.Items.map(item => ({
    request_id: item.request_id.S!,
    created_at: item.created_at.S!,
    status: item.status.S as DeploymentRequest['status'],
    deployment_type: item.deployment_type.S as DeploymentRequest['deployment_type'],
    cluster_config: JSON.parse(item.cluster_config.S!),
    retry_count: parseInt(item.retry_count.N!),
    max_retries: parseInt(item.max_retries.N!),
    retry_interval_minutes: parseInt(item.retry_interval_minutes.N!),
    scheduled_time: item.scheduled_time.S!,
    expires_at: parseInt(item.expires_at.N!),
    ...(item.last_retry_at && { last_retry_at: item.last_retry_at.S }),
    ...(item.approval_metadata && { approval_metadata: JSON.parse(item.approval_metadata.S!) }),
    ...(item.execution_metadata && { execution_metadata: JSON.parse(item.execution_metadata.S!) })
  }));
}
