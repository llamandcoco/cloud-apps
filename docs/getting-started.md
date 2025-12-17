# Getting Started

This guide helps you get started with the platform applications repository.

## Prerequisites

- **AWS Account** with appropriate permissions
- **AWS CLI** configured (`aws configure`)
- **Node.js 20+** for CDK and Node.js Lambda handlers
- **Python 3.12+** for Python Lambda handlers
- **Go 1.21+** for Go Lambda handlers
- **AWS CDK CLI**: `npm install -g aws-cdk`

## Repository Structure

```
platform-applications/
├── applications/          # All platform applications
│   ├── chatops/          # ChatOps category
│   ├── automation/       # Automation category
│   └── services/         # Services category
├── docs/                 # Documentation
├── shared/               # Shared utilities
└── .github/workflows/    # CI/CD workflows
```

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd platform-applications
```

### 2. Deploy an Example Application

Let's deploy the Slack bot example:

```bash
cd applications/chatops/slack-bot
```

### 3. Add Secrets to Parameter Store

Before deploying, add required secrets:

```bash
# Slack bot token
aws ssm put-parameter \
  --name /slack-bot/staging/token \
  --value "xoxb-your-slack-token" \
  --type SecureString \
  --description "Slack bot OAuth token"

# Slack signing secret
aws ssm put-parameter \
  --name /slack-bot/staging/signing-secret \
  --value "your-signing-secret" \
  --type SecureString \
  --description "Slack request signing secret"
```

### 4. Deploy Infrastructure

```bash
cd infrastructure
npm install
npx cdk bootstrap  # First time only
npx cdk deploy
```

The deploy command will:
1. Build CDK TypeScript code
2. Package Lambda functions (Node.js, Python, Go)
3. Create CloudFormation stack
4. Deploy to AWS

### 5. Get the API Endpoint

After deployment, CDK outputs the API Gateway URL:

```
Outputs:
SlackBotStack.APIEndpoint = https://abc123.execute-api.us-east-1.amazonaws.com/staging/
```

### 6. Configure Slack

1. Go to https://api.slack.com/apps
2. Create new app or select existing
3. Add slash command:
   - Command: `/bot`
   - Request URL: `<API-Gateway-URL>/slack/command`
4. Install app to workspace

### 7. Test

In Slack:

```
/bot aws list-instances
```

You should receive:
```
✅ Command received! Executing list-instances on aws...
Intent ID: intent-1234567890
```

## Creating a New Application

### Option 1: From Scratch

1. **Create directory structure:**

```bash
mkdir -p applications/category/app-name/{infrastructure/{bin,lib},runtime/handlers,tests}
```

2. **Create CDK infrastructure:**

```typescript
// infrastructure/lib/stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class MyAppStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const handler = new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../../runtime/handlers/main'),
      environment: {
        ENVIRONMENT: 'production'  // Non-sensitive only!
      }
    });

    // Grant Parameter Store access
    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:*:*:parameter/my-app/production/*`]
    }));
  }
}
```

3. **Implement runtime handler:**

```typescript
// runtime/handlers/main/index.ts
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

async function getSecret(name: string): Promise<string> {
  const result = await ssm.send(new GetParameterCommand({
    Name: name,
    WithDecryption: true
  }));
  return result.Parameter!.Value!;
}

export async function handler(event: any) {
  const apiKey = await getSecret('/my-app/production/api-key');
  // Use the API key...
  
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Success' })
  };
}
```

4. **Add secrets:**

```bash
aws ssm put-parameter \
  --name /my-app/production/api-key \
  --value "your-secret" \
  --type SecureString
```

5. **Deploy:**

```bash
cd infrastructure
npm install
npx cdk deploy
```

## Development Workflow

### Making Infrastructure Changes

1. Edit CDK code in `infrastructure/lib/`
2. Test: `npm test`
3. Preview: `npx cdk diff`
4. Deploy: `npx cdk deploy`

### Making Runtime Changes

#### Node.js

```bash
cd runtime/handlers/your-handler
npm install
npm test
# Deploy (CDK will package automatically)
cd ../../infrastructure
npx cdk deploy
```

#### Python

```bash
cd runtime/handlers/your-handler
pip install -r requirements.txt
pytest
# Deploy
cd ../../infrastructure
npx cdk deploy
```

#### Go

```bash
cd runtime/handlers/your-handler
go mod download
go test ./...
./build.sh  # Creates 'bootstrap' binary
# Deploy
cd ../../infrastructure
npx cdk deploy
```

### Local Testing

#### Test Lambda Locally (SAM)

```bash
cd infrastructure
sam local invoke MyFunction -e test-events/event.json
```

#### Test Runtime Code

```bash
# Node.js
cd runtime/handlers/your-handler
npm test

# Python
pytest

# Go
go test ./...
```

## Common Tasks

### Rotate a Secret

```bash
# Update in Parameter Store
aws ssm put-parameter \
  --name /app/production/secret \
  --value "new-value" \
  --overwrite

# No redeployment needed!
# Lambda will fetch new value after cache expires (5 minutes)
```

### View Logs

```bash
# CloudWatch Logs
aws logs tail /aws/lambda/my-function --follow

# Or use CDK
npx cdk logs /aws/lambda/my-function --follow
```

### Rollback Deployment

```bash
# CloudFormation auto-rollback on failure
# Manual rollback:
aws cloudformation update-stack \
  --stack-name MyStack \
  --use-previous-template
```

### Delete Application

```bash
cd infrastructure
npx cdk destroy
```

## Environment Management

Applications support multiple environments via CDK context:

```bash
# Deploy to staging
npx cdk deploy -c environment=staging

# Deploy to production
npx cdk deploy -c environment=production
```

Infrastructure uses the environment context to:
- Select parameter paths: `/app/${environment}/*`
- Name resources: `app-${environment}-function`
- Configure settings (log retention, alarms, etc.)

## Security Best Practices

1. **Always fetch secrets at runtime** - See [secret-management.md](secret-management.md)
2. **Use least-privilege IAM policies** - Grant only what's needed
3. **Never commit secrets** - Use `.gitignore` for sensitive files
4. **Enable CloudTrail logging** - Audit all API calls
5. **Encrypt everything** - Use KMS for Parameter Store

## Monitoring

Each application includes:
- **CloudWatch Logs**: Lambda execution logs
- **CloudWatch Metrics**: Invocations, errors, duration
- **CloudWatch Alarms**: Error rate, queue depth
- **CloudTrail**: API call audit logs

View in AWS Console or:

```bash
# Logs
aws logs tail /aws/lambda/function-name --follow

# Metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=function-name \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

## Troubleshooting

### CDK Deploy Fails

1. Check AWS credentials: `aws sts get-caller-identity`
2. Bootstrap CDK: `npx cdk bootstrap`
3. Check IAM permissions
4. View CloudFormation events in AWS Console

### Lambda Errors

1. Check CloudWatch Logs: `/aws/lambda/function-name`
2. Verify secrets exist in Parameter Store
3. Check IAM permissions for Parameter Store access
4. Test locally with SAM: `sam local invoke`

### Secret Access Denied

1. Verify parameter exists: `aws ssm get-parameter --name /path`
2. Check IAM policy attached to Lambda role
3. Verify parameter path matches hardcoded path in code
4. Check CloudTrail for access attempts

## Next Steps

- Read [ARCHITECTURE.md](../ARCHITECTURE.md) to understand design decisions
- Read [SECURITY.md](../SECURITY.md) for security patterns
- Explore the example application: `applications/chatops/slack-bot/`
- Read [multi-cloud-adapters.md](multi-cloud-adapters.md) for multi-cloud support

## Getting Help

- GitHub Issues: Report bugs or request features
- Documentation: See `docs/` directory
- Examples: See `applications/` for working examples

## Contributing

1. Create feature branch
2. Follow security patterns (runtime secrets!)
3. Write tests
4. Submit pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.
