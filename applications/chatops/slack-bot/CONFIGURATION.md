# Configuration Guide

This document explains how configuration values flow from infrastructure (Terragrunt) to application code (Lambda).

## Configuration Flow

```
root.hcl (org_prefix: "laco")
    ↓
_env_common.hcl (environment: "plt")
    ↓
terragrunt.hcl (environment variables)
    ↓
Lambda Runtime (process.env)
    ↓
Application Code (config.ts)
```

## Infrastructure Configuration

### root.hcl
```hcl
locals {
  org_prefix = "laco"  # Organization prefix
  # ...
}
```

### _env_common.hcl
```hcl
locals {
  environment = "plt"  # Environment: plt/dev/prd
  # ...
}
```

### Lambda terragrunt.hcl
```hcl
environment_variables = {
  ORG_PREFIX              = include.root.locals.org_prefix
  ENVIRONMENT             = include.env.locals.environment
  AWS_PARAMETER_PREFIX    = "/${include.root.locals.org_prefix}/${include.env.locals.environment}"
  EVENTBRIDGE_BUS_NAME    = "${include.root.locals.org_prefix}-${include.env.locals.environment}-chatbot"
  LOG_LEVEL               = "info"
  NODE_ENV                = "production"
}
```

## Application Configuration

### config.ts
Centralized configuration management:

```typescript
import { config } from './shared/config';

const appConfig = config.get();
// {
//   orgPrefix: "laco",
//   environment: "plt",
//   awsRegion: "ca-central-1",
//   parameterPrefix: "/laco/plt",
//   eventBridgeBusName: "laco-plt-chatbot",
//   logLevel: "info",
//   isLocal: false
// }
```

### Helper Functions

**Get Parameter Store path:**
```typescript
config.getParameterPath('slack/bot-token')
// Returns: "/laco/plt/aws/secrets/slack/bot-token"
```

**Get resource name:**
```typescript
config.getResourceName('lambda', 'router')
// Returns: "laco-plt-lambda-router"
```

**Environment checks:**
```typescript
config.isDevelopment()  // true for local/dev
config.isProduction()   // true for prd
```

## Environment Variables

### Runtime (Lambda)
| Variable | Example | Description |
|----------|---------|-------------|
| `ORG_PREFIX` | `laco` | Organization prefix from root.hcl |
| `ENVIRONMENT` | `plt` | Environment name from _env_common.hcl |
| `AWS_PARAMETER_PREFIX` | `/laco/plt` | Parameter Store prefix |
| `EVENTBRIDGE_BUS_NAME` | `laco-plt-chatbot` | EventBridge bus name |
| `AWS_REGION` | `ca-central-1` | AWS region |
| `LOG_LEVEL` | `info` | Logging level |
| `NODE_ENV` | `production` | Node environment |

### Local Development
| Variable | Example | Description |
|----------|---------|-------------|
| `ORG_PREFIX` | `laco` | Organization prefix |
| `ENVIRONMENT` | `local` | Set to "local" |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | LocalStack endpoint |
| `SLACK_BOT_TOKEN` | `xoxb-...` | Local Slack token |
| `SLACK_SIGNING_SECRET` | `...` | Local signing secret |

## Parameter Store Paths

With `ORG_PREFIX=laco` and `ENVIRONMENT=plt`:

```
/laco/plt/aws/secrets/slack/bot-token
/laco/plt/aws/secrets/slack/signing-secret
/laco/plt/aws/secrets/openai/api-key
/laco/plt/aws/secrets/github/token
```

## Resource Naming Convention

All AWS resources follow this pattern:
```
{org_prefix}-{environment}-{resource_type}-{name}
```

Examples:
- EventBridge Bus: `laco-plt-chatbot`
- SQS Queue: `laco-plt-chatbot-echo`
- Lambda: `laco-plt-slack-router`
- DLQ: `laco-plt-chatbot-echo-dlq`

## Multi-Environment Support

### Platform (plt)
```bash
ORG_PREFIX=laco
ENVIRONMENT=plt
→ /laco/plt/aws/secrets/*
→ laco-plt-chatbot
```

### Development (dev)
```bash
ORG_PREFIX=laco
ENVIRONMENT=dev
→ /laco/dev/aws/secrets/*
→ laco-dev-chatbot
```

### Production (prd)
```bash
ORG_PREFIX=laco
ENVIRONMENT=prd
→ /laco/prd/aws/secrets/*
→ laco-prd-chatbot
```

### Local
```bash
ORG_PREFIX=laco
ENVIRONMENT=local
→ Environment variables (no Parameter Store)
→ LocalStack resources
```

## Usage Examples

### Accessing Configuration
```typescript
import { config } from './shared/config';

// Get full config
const cfg = config.get();
console.log(cfg.environment);  // "plt"
console.log(cfg.orgPrefix);    // "laco"

// Get parameter path
const path = config.getParameterPath('slack/bot-token');
// "/laco/plt/aws/secrets/slack/bot-token"

// Check environment
if (config.isDevelopment()) {
  console.log('Running in dev mode');
}
```

### Logging with Context
```typescript
import { logger } from './shared/logger';

logger.info('Processing command', { command: '/echo' });
// Output:
// {
//   "level": "info",
//   "message": "Processing command",
//   "timestamp": "2024-01-15T10:30:00.000Z",
//   "environment": "plt",
//   "org": "laco",
//   "command": "/echo"
// }
```

### Fetching Secrets
```typescript
import { getSecret } from './shared/secrets';

// Automatically uses correct parameter path
const token = await getSecret('slack/bot-token');
// Fetches from: /laco/plt/aws/secrets/slack/bot-token
```

## Changing Configuration

### Change Organization Prefix
Edit `cloud-sandbox/root.hcl`:
```hcl
locals {
  org_prefix = "neworg"  # Change this
}
```

Then redeploy:
```bash
cd cloud-sandbox/aws/10-plt
terragrunt run-all apply
```

### Change Environment
Edit `cloud-sandbox/aws/XX-env/_env_common.hcl`:
```hcl
locals {
  environment = "staging"  # Change this
}
```

### Add New Environment Variable
Edit Lambda's `terragrunt.hcl`:
```hcl
environment_variables = {
  # ... existing vars
  NEW_VAR = "value"
}
```

Update `config.ts`:
```typescript
export interface AppConfig {
  // ... existing fields
  newVar: string;
}

constructor() {
  this.config = {
    // ... existing config
    newVar: process.env.NEW_VAR || 'default'
  };
}
```

## Best Practices

1. **Never hardcode values** - Always use config
2. **Use helper functions** - `getParameterPath()`, `getResourceName()`
3. **Environment checks** - Use `isDevelopment()`, `isProduction()`
4. **Consistent naming** - Follow `{org}-{env}-{type}-{name}` pattern
5. **Local testing** - Set `ENVIRONMENT=local` for local development

## Troubleshooting

### Wrong parameter path
Check `AWS_PARAMETER_PREFIX` environment variable:
```typescript
console.log(config.get().parameterPrefix);
```

### Wrong EventBridge bus
Check `EVENTBRIDGE_BUS_NAME`:
```typescript
console.log(config.get().eventBridgeBusName);
```

### Configuration not updating
1. Rebuild Lambda: `npm run build`
2. Repackage: `npm run package`
3. Redeploy: `terragrunt apply`
