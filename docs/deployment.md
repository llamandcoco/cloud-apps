# Deployment Guide

This guide covers deployment strategies and best practices for platform applications.

## Deployment Architecture

Each application is an **independent deployment unit**:

```
Application
├── Infrastructure (CDK)
│   └── Deploys to CloudFormation
├── Runtime (Lambda)
│   └── Packaged and deployed by CDK
└── Secrets (Parameter Store)
    └── Created manually or via scripts
```

## Pre-Deployment Checklist

Before deploying an application:

- [ ] Secrets added to Parameter Store
- [ ] IAM permissions configured in CDK
- [ ] Environment variables contain only non-sensitive config
- [ ] Tests passing (`npm test`, `pytest`, `go test`)
- [ ] CDK synthesis succeeds (`npx cdk synth`)
- [ ] Changes reviewed via `npx cdk diff`

## Deployment Methods

### Method 1: Direct CDK Deploy

**Use for:** Development, staging, quick iteration

```bash
cd applications/your-app/infrastructure
npm install
npx cdk deploy
```

Options:
```bash
# Deploy to specific environment
npx cdk deploy -c environment=staging

# Auto-approve (skip confirmation)
npx cdk deploy --require-approval never

# Deploy specific stack
npx cdk deploy MySpecificStack
```

### Method 2: CI/CD Pipeline (Recommended for Production)

**Use for:** Production, automated deployments, team workflows

See `.github/workflows/deploy-app.yml` for example GitHub Actions workflow.

```yaml
name: Deploy Application

on:
  push:
    branches: [main]
    paths:
      - 'applications/chatops/slack-bot/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1
      
      - name: Install dependencies
        run: |
          cd applications/chatops/slack-bot/infrastructure
          npm install
      
      - name: Run tests
        run: npm test
      
      - name: Deploy
        run: npx cdk deploy --require-approval never
```

## Environment Strategy

### Environment Selection via Context

Applications use CDK context to select environments:

```typescript
// infrastructure/bin/app.ts
const environment = app.node.tryGetContext('environment') || 'staging';
```

Deploy to different environments:

```bash
# Staging (default)
npx cdk deploy

# Production
npx cdk deploy -c environment=production
```

### Environment-Specific Configuration

```typescript
// infrastructure/lib/stack.ts
const config = {
  staging: {
    logRetention: logs.RetentionDays.ONE_WEEK,
    alarmThreshold: 10,
    memory: 256
  },
  production: {
    logRetention: logs.RetentionDays.ONE_MONTH,
    alarmThreshold: 5,
    memory: 512
  }
};

const envConfig = config[environment];
```

## Secret Management in Deployment

### Adding Secrets (One-Time Setup)

```bash
# Staging
aws ssm put-parameter \
  --name /app/staging/secret \
  --value "staging-secret-value" \
  --type SecureString

# Production
aws ssm put-parameter \
  --name /app/production/secret \
  --value "production-secret-value" \
  --type SecureString
```

### Secret Rotation (No Redeployment Needed)

```bash
aws ssm put-parameter \
  --name /app/production/secret \
  --value "new-secret-value" \
  --overwrite
```

Lambda will fetch the new value after cache expires (typically 5 minutes).

## Multi-Language Deployments

CDK handles packaging for all Lambda runtimes:

### Node.js
- CDK automatically bundles `node_modules`
- Uses `package.json` dependencies
- No build step required

### Python
- CDK bundles Python files and `requirements.txt`
- Use `@aws-cdk/aws-lambda-python-alpha` for automatic bundling
- Alternative: Pre-build deployment package

### Go
- **Requires pre-build step**
- Build `bootstrap` binary for Lambda custom runtime
- Run `build.sh` before deploying

```bash
cd runtime/handlers/executor
./build.sh
cd ../../../infrastructure
npx cdk deploy
```

## Deployment Workflow

### 1. Development

```bash
# Make changes
edit runtime/handlers/main/index.ts

# Test locally
npm test

# Preview changes
cd infrastructure
npx cdk diff

# Deploy to staging
npx cdk deploy -c environment=staging
```

### 2. Staging

```bash
# Deploy to staging
npx cdk deploy -c environment=staging

# Test in staging
curl https://staging-api.example.com/test

# Monitor logs
aws logs tail /aws/lambda/app-staging-function --follow
```

### 3. Production

```bash
# Deploy to production
npx cdk deploy -c environment=production

# Verify deployment
aws cloudformation describe-stacks --stack-name MyAppStack-production

# Monitor for errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=app-production-function \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum
```

## Rollback Strategies

### Automatic Rollback

CloudFormation automatically rolls back on deployment failure.

### Manual Rollback

#### Option 1: Redeploy Previous Version

```bash
# Checkout previous version
git checkout <previous-commit>

# Redeploy
cd infrastructure
npx cdk deploy
```

#### Option 2: CloudFormation Rollback

```bash
aws cloudformation cancel-update-stack --stack-name MyAppStack

# Or update to previous template
aws cloudformation update-stack \
  --stack-name MyAppStack \
  --use-previous-template
```

#### Option 3: Lambda Version Rollback

If using Lambda versioning:

```bash
# Update alias to point to previous version
aws lambda update-alias \
  --function-name my-function \
  --name production \
  --function-version <previous-version>
```

## Blue/Green Deployments

For zero-downtime deployments:

```typescript
// infrastructure/lib/stack.ts
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';

const alias = new lambda.Alias(this, 'Alias', {
  aliasName: 'production',
  version: handler.currentVersion
});

new codedeploy.LambdaDeploymentGroup(this, 'DeploymentGroup', {
  alias,
  deploymentConfig: codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES
});
```

## Monitoring Deployments

### CloudFormation Events

```bash
aws cloudformation describe-stack-events \
  --stack-name MyAppStack \
  --max-items 20
```

### Lambda Deployment Status

```bash
aws lambda get-function --function-name my-function
```

### CloudWatch Alarms

Set up alarms to monitor deployments:

```typescript
const errorAlarm = new cloudwatch.Alarm(this, 'ErrorAlarm', {
  metric: handler.metricErrors({
    statistic: 'Sum',
    period: cdk.Duration.minutes(5)
  }),
  threshold: 5,
  evaluationPeriods: 1
});
```

Monitor during deployment:

```bash
aws cloudwatch describe-alarms \
  --alarm-names MyApp-ErrorAlarm \
  --state-value ALARM
```

## Deployment Best Practices

### 1. Infrastructure as Code

- ✅ All infrastructure in CDK (TypeScript)
- ✅ Version controlled
- ✅ Reviewed via pull requests
- ❌ No manual ClickOps in AWS Console

### 2. Gradual Rollouts

For production:
- Deploy to staging first
- Use canary or linear deployments
- Monitor metrics during rollout
- Automatic rollback on errors

### 3. Immutable Deployments

- ✅ Deploy new version, switch traffic
- ❌ Modify running infrastructure

### 4. Testing

Test before deploying to production:
- Unit tests (`npm test`, `pytest`)
- Integration tests (SAM local)
- CDK snapshot tests

### 5. Secrets Management

- ✅ Secrets in Parameter Store
- ✅ Fetched at runtime
- ❌ Never in CloudFormation or environment variables

## Cost Optimization

### Lambda
- Right-size memory (affects CPU)
- Use ARM64 architecture (20% cheaper)
- Monitor unused functions

### CloudWatch Logs
- Set appropriate retention periods
- Use log sampling for high-volume logs

### Parameter Store
- Use Standard tier (free) when possible
- Advanced tier ($0.05/parameter) for larger values

## Troubleshooting Deployments

### Error: "No export named X found"

**Cause:** Cross-stack reference missing

**Solution:**
```typescript
// Export from source stack
new cdk.CfnOutput(this, 'Export', {
  value: myValue,
  exportName: 'MyExport'
});

// Import in target stack
const imported = cdk.Fn.importValue('MyExport');
```

### Error: "Resource already exists"

**Cause:** CDK trying to create a resource that exists

**Solution:**
- Use `cdk import` to import existing resources
- Or delete the resource and let CDK recreate

### Error: "Circular dependency detected"

**Cause:** Stack A depends on Stack B, which depends on Stack A

**Solution:**
- Refactor to remove circular dependency
- Use cross-stack references or SSM parameters

### Lambda Deployment Package Too Large

**Cause:** Dependencies exceed Lambda limit (250MB unzipped)

**Solution:**
- Use Lambda Layers for large dependencies
- Remove unused dependencies
- Use smaller libraries

## Multi-Cloud Deployments

For multi-cloud applications:

1. **Control plane (AWS)** deploys via CDK
2. **Other clouds** (GCP, Azure) use cloud-specific adapters
3. Credentials stored in AWS Parameter Store
4. Execution delegated from AWS Lambda

See [multi-cloud-adapters.md](multi-cloud-adapters.md) for details.

## Disaster Recovery

### Backup Strategy

- CloudFormation templates in Git
- Parameter Store values backed up to S3
- Lambda function versions retained

### Recovery Process

1. Redeploy infrastructure: `npx cdk deploy`
2. Restore secrets from backup
3. Verify functionality

## Security Considerations

- Use IAM roles for deployment (OIDC, not access keys)
- Scan dependencies for vulnerabilities
- Enable CloudTrail for deployment audit
- Use least-privilege IAM policies
- Never deploy secrets in templates

## Questions?

For more information:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [getting-started.md](getting-started.md)
