# Secret Management Guide

This guide explains how to securely manage secrets in platform applications.

## Core Principle

**Secrets MUST be fetched at runtime using IAM-based access.**

**NEVER inject secrets at deploy time.**

## Quick Reference

### ✅ DO THIS

```typescript
// Infrastructure (CDK)
const lambda = new lambda.Function(this, 'Handler', {
  environment: {
    ENVIRONMENT: 'production'  // Non-sensitive only
  }
});

// Grant IAM permissions
lambda.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [`arn:aws:ssm:*:*:parameter/app/production/*`]
}));

// Runtime (Node.js)
const ssm = new SSMClient({});
const secret = await ssm.send(new GetParameterCommand({
  Name: '/app/production/api-key',
  WithDecryption: true
}));
```

### ❌ DON'T DO THIS

```typescript
// Infrastructure (CDK)
const lambda = new lambda.Function(this, 'Handler', {
  environment: {
    API_KEY: 'secret-value',              // ❌ Secret in code
    SECRET_PATH: '/app/token'             // ❌ Even paths are not allowed
  }
});
```

## Adding Secrets

### Step 1: Create Parameter in Parameter Store

```bash
aws ssm put-parameter \
  --name /app-name/environment/secret-name \
  --value "your-secret-value" \
  --type SecureString \
  --description "Description of the secret"
```

### Step 2: Grant IAM Permissions in CDK

```typescript
handler.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:${region}:${account}:parameter/app-name/environment/*`
  ]
}));
```

### Step 3: Fetch at Runtime

#### Node.js

```typescript
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

async function getSecret(name: string): Promise<string> {
  const result = await ssm.send(new GetParameterCommand({
    Name: name,
    WithDecryption: true
  }));
  return result.Parameter!.Value!;
}

// Usage
const token = await getSecret('/app-name/production/token');
```

#### Python

```python
import boto3

ssm = boto3.client('ssm')

def get_secret(name: str) -> str:
    response = ssm.get_parameter(
        Name=name,
        WithDecryption=True
    )
    return response['Parameter']['Value']

# Usage
token = get_secret('/app-name/production/token')
```

#### Go

```go
import (
    "github.com/aws/aws-sdk-go/aws"
    "github.com/aws/aws-sdk-go/service/ssm"
)

func getSecret(svc *ssm.SSM, name string) (string, error) {
    result, err := svc.GetParameter(&ssm.GetParameterInput{
        Name:           aws.String(name),
        WithDecryption: aws.Bool(true),
    })
    if err != nil {
        return "", err
    }
    return *result.Parameter.Value, nil
}

// Usage
token, err := getSecret(ssmClient, "/app-name/production/token")
```

## Parameter Naming Convention

```
/application-name/environment/secret-name
```

Examples:
- `/slack-bot/production/token`
- `/cost-reporter/staging/api-key`
- `/terraform-bot/production/webhook-url`

## Caching Secrets

Implement caching to reduce API calls:

```typescript
const cache = new Map<string, { value: string, expiresAt: number }>();

async function getSecretCached(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  
  const value = await getSecret(name);
  cache.set(name, {
    value,
    expiresAt: Date.now() + 5 * 60 * 1000  // 5 minutes
  });
  return value;
}
```

**Why cache?**
- Reduces Parameter Store API calls (cost)
- Improves performance
- Still allows rotation (5-minute TTL)

## Rotating Secrets

### Manual Rotation

1. Update Parameter Store:
   ```bash
   aws ssm put-parameter \
     --name /app/production/token \
     --value "new-secret-value" \
     --overwrite
   ```

2. **No redeployment needed!** Lambda will fetch new value after cache expires.

### Automatic Rotation

For database passwords or frequently rotated secrets, use Secrets Manager:

1. Create secret in Secrets Manager
2. Enable automatic rotation
3. Update runtime code to use Secrets Manager SDK

## Common Mistakes

### 1. Exposing Parameter Paths

```typescript
// ❌ BAD: Path in environment variable
environment: {
  SECRET_PATH: '/app/token'
}

// ✅ GOOD: Hardcode path in code
const token = await getSecret('/app/production/token');
```

**Why?** Even parameter *names* can leak information.

### 2. Logging Secrets

```typescript
// ❌ BAD
const token = await getSecret('/app/token');
console.log(`Token: ${token}`);

// ✅ GOOD
const token = await getSecret('/app/token');
console.log('Token retrieved successfully');
```

### 3. Secrets in Error Messages

```typescript
// ❌ BAD
catch (error) {
  throw new Error(`Failed to connect with token ${token}`);
}

// ✅ GOOD
catch (error) {
  throw new Error('Failed to connect to API');
}
```

## Security Checklist

Before deploying:

- [ ] Secrets fetched at runtime, not at deploy time
- [ ] IAM policies use least-privilege with path restrictions
- [ ] Parameter paths hardcoded in code, not in environment
- [ ] No secrets in CloudFormation templates
- [ ] Logging doesn't expose sensitive data
- [ ] Error handling doesn't leak secrets
- [ ] Caching implemented with reasonable TTL

## Auditing

All Parameter Store access is logged to CloudTrail:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetParameter
```

## Questions?

See [SECURITY.md](../SECURITY.md) for comprehensive security patterns.
