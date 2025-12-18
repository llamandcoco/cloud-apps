import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';

/**
 * Slack Command Handler (Node.js)
 * 
 * ARCHITECTURE:
 * - Receives Slack slash commands via API Gateway
 * - Validates request signature using Slack signing secret
 * - Creates intent object
 * - Enqueues intent to SQS for async execution
 * - Responds immediately to Slack
 * 
 * SECURITY:
 * - Fetches Slack secrets at runtime from Parameter Store
 * - Uses IAM-based access (no secrets in environment)
 * - Parameter paths hardcoded in code
 * - Validates Slack request signatures
 */

// ============================================================================
// Configuration
// ============================================================================

const ENVIRONMENT = process.env.ENVIRONMENT || 'staging';
const INTENT_QUEUE_URL = process.env.INTENT_QUEUE_URL!;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// AWS clients
const ssmClient = new SSMClient({});
const sqsClient = new SQSClient({});

// ============================================================================
// Secret Management - RUNTIME RETRIEVAL PATTERN
// ============================================================================

/**
 * Secret cache with expiration
 * 
 * WHY CACHE?
 * - Reduces Parameter Store API calls
 * - Improves performance (no API call on every request)
 * - Reduces cost
 * 
 * WHY EXPIRATION?
 * - Allows secret rotation without redeployment
 * - Balances performance and security
 * - 5-minute TTL is reasonable for most use cases
 */
interface CachedSecret {
  value: string;
  expiresAt: number;
}

const secretCache = new Map<string, CachedSecret>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch secret from Parameter Store with caching
 * 
 * SECURITY PATTERN:
 * ✅ Parameter path is hardcoded in code
 * ✅ No environment variables with paths
 * ✅ IAM policy restricts access to /slack-bot/{environment}/*
 * ✅ Encryption enabled (WithDecryption: true)
 * 
 * @param parameterName - Parameter Store path
 * @returns Secret value
 */
async function getSecret(parameterName: string): Promise<string> {
  // Check cache first
  const cached = secretCache.get(parameterName);
  if (cached && cached.expiresAt > Date.now()) {
    log('debug', `Using cached secret: ${parameterName}`);
    return cached.value;
  }

  log('info', `Fetching secret from Parameter Store: ${parameterName}`);

  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true // CRITICAL: Enable decryption
    });

    const response = await ssmClient.send(command);

    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${parameterName} not found or empty`);
    }

    const value = response.Parameter.Value;

    // Cache the secret
    secretCache.set(parameterName, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS
    });

    return value;
  } catch (error) {
    // ✅ GOOD: Error doesn't leak secret value
    log('error', `Failed to fetch secret ${parameterName}: ${error}`);
    throw new Error(`Failed to retrieve secret: ${parameterName}`);
  }
}

/**
 * Get Slack bot token
 * 
 * SECURITY:
 * - Path is HARDCODED, not from environment
 * - Environment variable only selects which path to use
 */
async function getSlackToken(): Promise<string> {
  // ✅ GOOD: Hardcoded path
  const parameterPath = `/slack-bot/${ENVIRONMENT}/token`;
  return getSecret(parameterPath);
}

/**
 * Get Slack signing secret (for request validation)
 */
async function getSlackSigningSecret(): Promise<string> {
  // ✅ GOOD: Hardcoded path
  const parameterPath = `/slack-bot/${ENVIRONMENT}/signing-secret`;
  return getSecret(parameterPath);
}

// ============================================================================
// Slack Request Validation
// ============================================================================

/**
 * Validate Slack request signature
 * 
 * SECURITY:
 * - Prevents unauthorized requests
 * - Uses timing-safe comparison
 * - Validates timestamp to prevent replay attacks
 */
async function validateSlackRequest(
  body: string,
  timestamp: string,
  signature: string
): Promise<boolean> {
  // Check timestamp (prevent replay attacks)
  const requestTimestamp = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const FIVE_MINUTES = 5 * 60;

  if (Math.abs(now - requestTimestamp) > FIVE_MINUTES) {
    log('warn', 'Request timestamp too old or too far in future');
    return false;
  }

  // Fetch signing secret
  const signingSecret = await getSlackSigningSecret();

  // Calculate signature
  const signatureBaseString = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', signingSecret);
  hmac.update(signatureBaseString);
  const calculatedSignature = `v0=${hmac.digest('hex')}`;

  // Timing-safe comparison
  try {
    const calculatedBuffer = Buffer.from(calculatedSignature);
    const providedBuffer = Buffer.from(signature);

    if (calculatedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(calculatedBuffer, providedBuffer);
  } catch (error) {
    log('error', `Signature validation error: ${error}`);
    return false;
  }
}

// ============================================================================
// Intent Creation and Queueing
// ============================================================================

interface Intent {
  id: string;
  operation: string;
  parameters: Record<string, any>;
  requestedBy: string;
  requestedAt: string;
  cloud: 'aws' | 'gcp' | 'azure';
  callbackUrl?: string;
}

/**
 * Parse Slack command and create intent
 */
function parseCommand(body: string): Intent {
  const params = new URLSearchParams(body);

  // reserved for future routing / audit
  const _command = params.get('command') || '';
  const text = params.get('text') || '';
  const userId = params.get('user_id') || 'unknown';
  const responseUrl = params.get('response_url') || undefined;

  // Parse command text: /bot <cloud> <operation> [args...]
  // Example: /bot aws create-vm instance-type=t3.micro
  const parts = text.trim().split(/\s+/);
  const cloud = (parts[0] || 'aws') as 'aws' | 'gcp' | 'azure';
  const operation = parts[1] || 'help';
  const args = parts.slice(2);

  // Parse args into parameters
  const parameters: Record<string, any> = {};
  args.forEach(arg => {
    const [key, value] = arg.split('=');
    if (key && value) {
      parameters[key] = value;
    }
  });

  return {
    id: `intent-${randomUUID()}`,
    operation,
    parameters,
    requestedBy: userId,
    requestedAt: new Date().toISOString(),
    cloud,
    callbackUrl: responseUrl
  };
}

/**
 * Enqueue intent to SQS for async execution
 */
async function enqueueIntent(intent: Intent): Promise<void> {
  log('info', `Enqueuing intent: ${intent.id} - ${intent.operation}`);

  const command = new SendMessageCommand({
    QueueUrl: INTENT_QUEUE_URL,
    MessageBody: JSON.stringify(intent),
    MessageAttributes: {
      operation: {
        DataType: 'String',
        StringValue: intent.operation
      },
      cloud: {
        DataType: 'String',
        StringValue: intent.cloud
      }
    }
  });

  await sqsClient.send(command);
  log('info', `Intent enqueued successfully: ${intent.id}`);
}

// ============================================================================
// Lambda Handler
// ============================================================================

/**
 * Main Lambda handler
 * 
 * FLOW:
 * 1. Validate Slack request signature
 * 2. Parse command into intent
 * 3. Enqueue intent for async execution
 * 4. Respond immediately to Slack
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    log('info', 'Received Slack command');

    // Extract headers
    const timestamp = event.headers['X-Slack-Request-Timestamp'] || '';
    const signature = event.headers['X-Slack-Signature'] || '';
    const body = event.body || '';

    // Validate Slack signature
    const isValid = await validateSlackRequest(body, timestamp, signature);
    if (!isValid) {
      log('warn', 'Invalid Slack signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid request signature' })
      };
    }

    // Parse command and create intent
    const intent = parseCommand(body);

    // Authorize user (example - implement your own logic)
    if (!isAuthorized(intent.requestedBy, intent.operation)) {
      log('warn', `Unauthorized: ${intent.requestedBy} -> ${intent.operation}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          response_type: 'ephemeral',
          text: `⛔ You are not authorized to execute: ${intent.operation}`
        })
      };
    }

    // Enqueue intent for async execution
    await enqueueIntent(intent);

    // Respond immediately to Slack
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        text: `✅ Command received! Executing \`${intent.operation}\` on ${intent.cloud}...`,
        attachments: [
          {
            text: `Intent ID: ${intent.id}`,
            color: '#36a64f'
          }
        ]
      })
    };
  } catch (error) {
    log('error', `Handler error: ${error}`);
    return {
      statusCode: 500,
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: '❌ Internal error processing command'
      })
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

function log(level: string, message: string): void {
  const levels: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  const currentLevel = levels[LOG_LEVEL] || 1;
  const messageLevel = levels[level] || 1;

  if (messageLevel >= currentLevel) {
    console.log(JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Authorization logic (example)
 * 
 * TODO: Implement real authorization
 * - Check user against allowed list
 * - Verify operation permissions
 * - Integrate with identity provider
 */
function isAuthorized(userId: string, operation: string): boolean {
  // Example: All users can run 'help', only admins can run 'destroy'
  const dangerousOperations = ['destroy', 'delete', 'terminate'];

  if (dangerousOperations.includes(operation)) {
    // TODO: Check if userId is admin
    return false; // For demo, deny all
  }

  return true;
}
