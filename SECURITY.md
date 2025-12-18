# Security Guidelines

This document outlines security patterns and best practices for platform applications.

## Core Security Principle

**Secrets MUST be fetched at runtime using IAM-based access. Deploy-time injection is FORBIDDEN.**

## Secret Management

### ❌ NEVER Do This

```typescript
// BAD: Environment variables with secrets
const lambda = new lambda.Function(this, 'Handler', {
  environment: {
    SLACK_TOKEN: 'xoxb-...',                    // Secret in code
    API_KEY: process.env.API_KEY,               // Secret from env
    DB_PASSWORD: ssm.StringParameter.valueForStringParameter(this, '/db/password') // Injected at deploy
  }
});
```

**Why this is dangerous:**
- Secrets appear in CloudFormation templates (visible in console)
- Secrets stored in Lambda environment variables (visible to anyone with Lambda read access)
- Secrets logged during deployments
- Secrets cannot be rotated without redeployment
- Audit trail is incomplete

### ✅ ALWAYS Do This

```typescript
// GOOD: No secrets in infrastructure
const lambda = new lambda.Function(this, 'Handler', {
  environment: {
    CONFIG_PROFILE: 'production',  // Non-sensitive selector only
    AWS_REGION: 'us-east-1'        // Public information only
  }
});

// Grant IAM permissions for runtime access
lambda.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['ssm:GetParameter', 'ssm:GetParameters'],
  resources: [
    `arn:aws:ssm:${this.region}:${this.account}:parameter/slack-bot/production/*`
  ]
}));
```

**Runtime code fetches secrets:**

```typescript
// runtime/handlers/slack-bot/index.ts
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

async function getSecret(name: string): Promise<string> {
  const command = new GetParameterCommand({
    Name: name,
    WithDecryption: true
  });
  const response = await ssm.send(command);
  return response.Parameter!.Value!;
}

export async function handler(event: any) {
  // Hardcoded path - no environment variable needed
  const slackToken = await getSecret('/slack-bot/production/token');
  // Use the token...
}
```

## Parameter Store Structure

### Path Hierarchy

```
/application-name/environment/secret-name
```

Examples:
```
/slack-bot/production/token
/slack-bot/production/signing-secret
/terraform-bot/production/api-key
/cost-reporter/production/webhook-url
```

### IAM Policy Pattern

**Least-privilege access per application:**

```typescript
// Grant access to specific application path only
lambda.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['ssm:GetParameter', 'ssm:GetParameters'],
  resources: [
    // Application-specific path only
    `arn:aws:ssm:${region}:${account}:parameter/slack-bot/production/*`
  ],
  conditions: {
    StringEquals: {
      'aws:RequestedRegion': region
    }
  }
}));
```

**Why path-based access?**
- Knowledge of parameter name is useless without IAM permission
- Applications cannot access each other's secrets
- Clear audit trail of which application accessed which secret
- Easy to manage with IaC

## Secret Rotation

### Manual Rotation

1. Update value in Parameter Store:
   ```bash
   aws ssm put-parameter \
     --name /slack-bot/production/token \
     --value "new-secret-value" \
     --type SecureString \
     --overwrite
   ```

2. **No redeployment needed** - Lambda will fetch new value on next execution

### Automatic Rotation

For secrets requiring automatic rotation (database passwords, API keys):

1. Use AWS Secrets Manager instead of Parameter Store
2. Enable automatic rotation with Lambda rotation function
3. Update runtime code to use Secrets Manager SDK

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});

async function getSecret(secretId: string): Promise<string> {
  const command = new GetSecretValueCommand({ SecretId: secretId });
  const response = await client.send(command);
  return response.SecretString!;
}
```

## Parameter Store vs Secrets Manager

| Feature | Parameter Store | Secrets Manager |
|---------|----------------|-----------------|
| Cost | Free (Standard), $0.05/parameter (Advanced) | $0.40/secret/month + $0.05/10k API calls |
| Rotation | Manual | Automatic (built-in for RDS, custom for others) |
| Versioning | Manual (overwrite) | Automatic (multiple versions) |
| Encryption | KMS (required for SecureString) | KMS (automatic) |
| Use Case | Most secrets | Database passwords, frequently rotated secrets |

**Default: Use Parameter Store** unless you need automatic rotation.

## Environment Variables: What's Allowed

Environment variables are **ONLY** for non-sensitive configuration:

### ✅ Allowed

```typescript
environment: {
  CONFIG_PROFILE: 'production',      // Environment selector
  AWS_REGION: 'us-east-1',           // Public information
  LOG_LEVEL: 'info',                 // Non-sensitive config
  FEATURE_FLAG_XYZ: 'true',          // Feature toggles
  MAX_RETRY_ATTEMPTS: '3'            // Non-sensitive parameters
}
```

### ❌ NOT Allowed

```typescript
environment: {
  SLACK_TOKEN: 'xoxb-...',           // Secret value
  API_KEY: 'sk-...',                 // Secret value
  DB_PASSWORD: 'password123',        // Secret value
  PARAM_PATH: '/slack-bot/token',    // Even paths are not allowed
  SECRET_NAME: 'slack-token'         // Secret identifiers
}
```

**Why no parameter paths in environment variables?**

Even parameter *names* can leak information:
- `/slack-bot/prod/admin-token` reveals the existence of an admin token
- `/db/master-password` reveals database structure
- Parameter paths in CloudFormation are visible to anyone with read access

Hardcode paths in application code instead:

```typescript
// GOOD: Path is in code, not in environment
const token = await getSecret('/slack-bot/production/token');

// BAD: Path comes from environment
const token = await getSecret(process.env.PARAM_PATH!);
```

## Public Repository Safety Checklist

Before committing code, verify:

- [ ] No secrets in code, comments, or commit messages
- [ ] No AWS account IDs (use `Aws.ACCOUNT_ID` in CDK)
- [ ] No hardcoded IPs or private DNS names
- [ ] No internal URLs or service endpoints
- [ ] No database connection strings
- [ ] No API keys or tokens (even revoked ones)
- [ ] No parameter paths in environment variables
- [ ] No `.env` files committed (use `.gitignore`)

## Least-Privilege IAM Policies

Each Lambda function should have:

1. **Minimal permissions** for its specific task
2. **Path-based restrictions** for Parameter Store/Secrets Manager
3. **Resource-specific ARNs** (no `*` wildcards)
4. **Condition keys** to restrict further

Example:

```typescript
const handler = new lambda.Function(this, 'SlackBotHandler', {
  // ... function config
});

// Specific permission for Parameter Store
handler.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:${region}:${account}:parameter/slack-bot/production/*`
  ]
}));

// Specific permission for SQS (if needed)
handler.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['sqs:SendMessage'],
  resources: [intentQueue.queueArn]
}));

// No broad permissions like s3:*, dynamodb:*, or ssm:*
```

## Audit and Monitoring

### CloudTrail Logging

All Parameter Store and Secrets Manager access is logged:

```json
{
  "eventName": "GetParameter",
  "requestParameters": {
    "name": "/slack-bot/production/token",
    "withDecryption": true
  },
  "userIdentity": {
    "principalId": "AIDAI....:slack-bot-handler",
    "arn": "arn:aws:sts::123456789012:assumed-role/slack-bot-handler-role/slack-bot-handler"
  }
}
```

### CloudWatch Alarms

Set up alarms for suspicious activity:

```typescript
// Alert on unauthorized access attempts
const unauthorizedAccessMetric = new cloudwatch.Metric({
  namespace: 'AWS/SSM',
  metricName: 'ParameterStoreUnauthorizedAccess',
  statistic: 'Sum'
});

new cloudwatch.Alarm(this, 'UnauthorizedAccess', {
  metric: unauthorizedAccessMetric,
  threshold: 1,
  evaluationPeriods: 1,
  alarmDescription: 'Alert on Parameter Store unauthorized access'
});
```

## Encryption

### At Rest

- Parameter Store SecureString: **KMS encryption required**
- Secrets Manager: **KMS encryption automatic**
- Use customer-managed KMS keys for additional control:

```typescript
const kmsKey = new kms.Key(this, 'SecretsKey', {
  description: 'KMS key for application secrets',
  enableKeyRotation: true
});

// Reference in Parameter Store (created outside CDK)
// aws ssm put-parameter --name /app/secret --value "..." --type SecureString --key-id <key-id>
```

### In Transit

- AWS SDK uses **TLS 1.2+** by default
- No additional configuration needed
- Secrets never transmitted in plain text

## Secrets in CI/CD

### GitHub Actions

Use GitHub Secrets for CI/CD credentials:

```yaml
# .github/workflows/deploy.yml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
    aws-region: us-east-1
```

**Never:**
- Hardcode AWS credentials in workflows
- Use long-lived access keys (use IAM roles with OIDC)
- Store secrets in repository variables (use GitHub Secrets)

## Common Pitfalls

### 1. Logging Secrets

```typescript
// BAD
const token = await getSecret('/slack-bot/token');
console.log(`Token: ${token}`);  // Logged to CloudWatch!

// GOOD
const token = await getSecret('/slack-bot/token');
console.log('Token retrieved successfully');
```

### 2. Error Messages

```typescript
// BAD
catch (error) {
  throw new Error(`Failed to connect with token ${token}`);
}

// GOOD
catch (error) {
  throw new Error('Failed to connect to Slack API');
}
```

### 3. Caching Secrets Insecurely

```typescript
// BAD: Cached in memory indefinitely
let cachedToken: string;
async function getToken() {
  if (!cachedToken) {
    cachedToken = await getSecret('/slack-bot/token');
  }
  return cachedToken;
}

// GOOD: Time-limited cache with refresh
const cache = new Map<string, { value: string, expiresAt: number }>();

async function getToken(): Promise<string> {
  const cached = cache.get('token');
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  
  const value = await getSecret('/slack-bot/token');
  cache.set('token', { 
    value, 
    expiresAt: Date.now() + 5 * 60 * 1000  // 5 minutes
  });
  return value;
}
```

## Security Review Checklist

Before deploying:

- [ ] Secrets fetched at runtime, not at deploy time
- [ ] IAM policies follow least-privilege
- [ ] Parameter paths hardcoded in code, not in environment
- [ ] No secrets in CloudFormation templates
- [ ] CloudTrail logging enabled
- [ ] KMS encryption for secrets
- [ ] Error handling doesn't leak secrets
- [ ] Logging doesn't expose sensitive data
- [ ] Dependencies are up to date (no known vulnerabilities)

## Incident Response

If a secret is leaked:

1. **Immediately revoke** the secret (API token, credential, etc.)
2. **Rotate** the secret in Parameter Store/Secrets Manager
3. **Verify** that Lambda picks up new secret (test execution)
4. **Audit** CloudTrail logs for unauthorized access
5. **Update** security controls to prevent recurrence
6. **Document** the incident and response

## Questions?

For security questions or to report vulnerabilities, contact the platform team.

**Remember: If you're unsure whether something is a secret, treat it as a secret.**
