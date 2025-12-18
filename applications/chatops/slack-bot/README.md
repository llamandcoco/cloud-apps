# Slack Bot

A production-ready ChatOps bot demonstrating multi-language Lambda handlers with secure secret management.

## Overview

This application showcases:

- **CDK infrastructure** in TypeScript
- **Multi-language Lambda handlers**:
  - Node.js (command handler)
  - Python (data processor)
  - Go (cloud executor)
- **Secure runtime secret retrieval** from Parameter Store
- **Multi-cloud execution adapters** (AWS, GCP, Azure)
- **Intent-based delegation** for async operations

## Architecture

```
Slack Command
     │
     ▼
┌──────────────────┐
│ Command Handler  │  (Node.js Lambda)
│ - Validates      │  - Fetches Slack token from Parameter Store
│ - Creates intent │  - Enqueues to SQS
└────────┬─────────┘
         │
         ▼
    ┌────────┐
    │  SQS   │
    └────┬───┘
         │
         ▼
┌──────────────────┐
│   Processor      │  (Python Lambda)
│ - Analyzes data  │  - Fetches API keys from Parameter Store
│ - Generates report│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Executor       │  (Go Lambda)
│ - Runs operation │  - Fetches cloud credentials
│ - Cloud adapters │  - Executes on target cloud
└──────────────────┘
```

## Prerequisites

- AWS CLI configured
- Node.js 20+
- Python 3.12+
- Go 1.21+
- AWS CDK CLI: `npm install -g aws-cdk`

## Setup

### 1. Add Secrets to Parameter Store

```bash
# Slack bot token
aws ssm put-parameter \
  --name /slack-bot/production/token \
  --value "xoxb-your-token-here" \
  --type SecureString \
  --description "Slack bot OAuth token"

# Slack signing secret
aws ssm put-parameter \
  --name /slack-bot/production/signing-secret \
  --value "your-signing-secret" \
  --type SecureString \
  --description "Slack request signing secret"

# GCP service account (for multi-cloud demo)
aws ssm put-parameter \
  --name /slack-bot/production/gcp-credentials \
  --value "$(cat gcp-service-account.json)" \
  --type SecureString \
  --description "GCP service account key"
```

### 2. Deploy Infrastructure

```bash
cd infrastructure
npm install
npx cdk bootstrap  # First time only
npx cdk deploy
```

### 3. Configure Slack App

1. Create Slack app at https://api.slack.com/apps
2. Add slash command pointing to API Gateway URL (from CDK output)
3. Install app to workspace
4. Copy bot token and signing secret to Parameter Store (step 1)

## Development

### Infrastructure Changes

```bash
cd infrastructure
npm test          # Run CDK tests
npx cdk diff      # Preview changes
npx cdk deploy    # Deploy changes
```

### Runtime Code Changes

#### Node.js Handler

```bash
cd runtime/handlers/command-handler
npm install
npm test
npm run build
```

#### Python Handler

```bash
cd runtime/handlers/processor
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

#### Go Handler

```bash
cd runtime/handlers/executor
go mod download
go test ./...
go build -o bootstrap main.go
```

### Local Testing

```bash
# Test secret retrieval (requires AWS credentials)
cd runtime/handlers/command-handler
npm test

# Test with SAM local
cd infrastructure
sam local invoke CommandHandler -e test-events/slack-command.json
```

## Security

### Secret Management

**All secrets are fetched at runtime:**

```typescript
// ✅ GOOD: Runtime retrieval
const token = await getSecret('/slack-bot/production/token');

// ❌ BAD: Environment variable
const token = process.env.SLACK_TOKEN;
```

**Parameter Store paths are hardcoded:**

```typescript
// ✅ GOOD: Hardcoded path
const SECRET_PATH = '/slack-bot/production/token';
const token = await getSecret(SECRET_PATH);

// ❌ BAD: Path from environment
const token = await getSecret(process.env.SECRET_PATH);
```

### IAM Permissions

Each Lambda has least-privilege access:

- Command Handler: Read `/slack-bot/production/*` parameters
- Processor: Read `/slack-bot/production/*` parameters
- Executor: Read `/slack-bot/production/*` and GCP/Azure credentials

### Audit

All secret access is logged to CloudTrail:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetParameter \
  --max-results 10
```

## Multi-Cloud Adapters

### Adding a New Cloud Provider

1. Implement `CloudExecutor` interface:

```typescript
// runtime/adapters/new-cloud-adapter.ts
export class NewCloudExecutor implements CloudExecutor {
  async execute(intent: OperationIntent): Promise<OperationResult> {
    // Fetch cloud credentials
    const credentials = await getSecret('/slack-bot/production/newcloud-credentials');
    
    // Execute operation
    // ...
    
    return { status: 'success', data: result };
  }
}
```

2. Register adapter in executor:

```typescript
// runtime/handlers/executor/main.go
case "newcloud":
    return NewCloudExecutor{}, nil
```

3. Add credentials to Parameter Store
4. Grant IAM permissions
5. Test in isolation

## Deployment

### Staging

```bash
cd infrastructure
npx cdk deploy -c environment=staging
```

### Production

```bash
cd infrastructure
npx cdk deploy -c environment=production
```

### Rollback

```bash
# CloudFormation automatic rollback on failure
# Manual rollback to previous version:
aws cloudformation update-stack \
  --stack-name SlackBotStack \
  --use-previous-template
```

## Monitoring

### CloudWatch Dashboards

Deployed automatically by CDK:

- Lambda invocations and errors
- SQS queue depth
- Parameter Store access patterns
- Multi-cloud adapter latency

### Alarms

Alarms are configured for:

- Lambda error rate > 5%
- SQS queue age > 5 minutes
- Unauthorized Parameter Store access

View in CloudWatch Console or:

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix SlackBot
```

## Troubleshooting

### Command not responding

1. Check CloudWatch Logs: `/aws/lambda/slack-bot-command-handler`
2. Verify Slack token in Parameter Store
3. Check IAM permissions

### Processor failing

1. Check CloudWatch Logs: `/aws/lambda/slack-bot-processor`
2. Verify SQS message format
3. Check Python dependencies in deployment package

### Multi-cloud execution failing

1. Check CloudWatch Logs: `/aws/lambda/slack-bot-executor`
2. Verify cloud credentials in Parameter Store
3. Test adapter in isolation: `go test ./adapters/...`

## Cost Estimation

Monthly cost (assuming 10,000 commands/month):

- Lambda invocations: ~$0.20
- Parameter Store: Free (Standard tier)
- SQS: Free (within free tier)
- CloudWatch Logs: ~$1.00
- **Total: ~$1.20/month**

## Contributing

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes following security patterns
3. Add tests for infrastructure and runtime code
4. Run `npm test` in infrastructure directory
5. Submit pull request

## License

MIT
