# Local Testing Guide - Slack Bot

Complete guide for testing Slack bot locally before deployment.

## Prerequisites

- Docker & Docker Compose
- Node.js 20+
- ngrok (for Slack webhook testing)
- AWS CLI (optional, for testing against real AWS)

## Setup

### 1. Environment Configuration

```bash
cd cloud-apps/applications/chatops/slack-bot

# Copy example environment
cp .env.local.example .env.local

# Edit with your test values
vim .env.local
```

### 2. Start LocalStack

```bash
# Start all services
docker-compose -f docker-compose.local.yml up -d

# Check services are running
docker-compose -f docker-compose.local.yml ps

# View logs
docker-compose -f docker-compose.local.yml logs -f localstack
```

### 3. Verify LocalStack Resources

```bash
# Check SQS queues
aws --endpoint-url=http://localhost:4566 sqs list-queues

# Check EventBridge bus
aws --endpoint-url=http://localhost:4566 events list-event-buses

# Check SSM parameters
aws --endpoint-url=http://localhost:4566 ssm get-parameter \
  --name /laco/local/aws/secrets/slack/bot-token \
  --with-decryption
```

## Testing Workflow

### Option 1: Unit Tests (Fast)

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Specific test file
npm test -- router.test.ts
```

### Option 2: Integration Tests (LocalStack)

```bash
# Ensure LocalStack is running
docker-compose -f docker-compose.local.yml up -d

# Run integration tests
npm run test:integration

# Test specific flow
npm run test:integration -- echo-flow.test.ts
```

### Option 3: Local Server + ngrok (Full E2E)

```bash
# Terminal 1: Start local server
npm run dev

# Terminal 2: Start ngrok
ngrok http 3000

# Terminal 3: Send test request
curl -X POST http://localhost:3000/slack/commands \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "command=/echo&text=hello+world&response_url=https://hooks.slack.com/test"
```

#### Configure Slack App

1. Go to https://api.slack.com/apps
2. Select your test app
3. **Slash Commands** → Edit `/echo`
4. **Request URL**: `https://YOUR-NGROK-URL.ngrok.io/slack/commands`
5. Save

Now test in Slack: `/echo hello world`

## Testing Each Component

### 1. Router Lambda

**Unit Test:**
```typescript
// tests/unit/router.test.ts
import { handler } from '../src/router';

test('router returns immediate response', async () => {
  const event = {
    body: 'command=/echo&text=test',
    headers: {
      'x-slack-signature': 'valid-signature'
    }
  };
  
  const result = await handler(event);
  
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).text).toContain('Processing');
});
```

**Integration Test:**
```typescript
// tests/integration/router-eventbridge.test.ts
test('router publishes to EventBridge', async () => {
  const event = createSlackEvent('/echo', 'test');
  
  await handler(event);
  
  // Check EventBridge received event
  const events = await getEventsFromLocalStack();
  expect(events).toHaveLength(1);
  expect(events[0].detail.command).toBe('/echo');
});
```

### 2. EventBridge Rules

**Test Rule Matching:**
```bash
# Send test event
aws --endpoint-url=http://localhost:4566 events put-events \
  --entries '[{
    "Source": "slack.command",
    "DetailType": "Slack Command",
    "Detail": "{\"command\":\"/echo\",\"text\":\"test\"}",
    "EventBusName": "laco-local-chatbot"
  }]'

# Check SQS queue received message
aws --endpoint-url=http://localhost:4566 sqs receive-message \
  --queue-url http://localhost:4566/000000000000/laco-local-sr-queue
```

### 3. Worker Lambdas

**Unit Test:**
```typescript
// tests/unit/workers/sr.test.ts
import { handler } from '../src/workers/sr';

test('sr worker responds correctly', async () => {
  const event = {
    Records: [{
      body: JSON.stringify({
        command: '/echo',
        text: 'hello',
        response_url: 'https://test.com'
      })
    }]
  };
  
  const result = await handler(event);
  
  expect(result.batchItemFailures).toHaveLength(0);
  // Verify Slack API was called
});
```

**Integration Test:**
```typescript
// tests/integration/echo-flow.test.ts
test('full echo flow', async () => {
  // 1. Send command to router
  await sendSlackCommand('/echo', 'test');
  
  // 2. Wait for EventBridge → SQS
  await sleep(1000);
  
  // 3. Manually trigger worker
  const messages = await getSQSMessages('laco-local-sr-queue');
  await srWorker.handler({ Records: messages });
  
  // 4. Verify Slack response
  expect(mockSlack.lastResponse).toBe('async test');
});
```

## Mock Services

### Mock Slack API

```typescript
// tests/mocks/slack.ts
import nock from 'nock';

export function mockSlackAPI() {
  nock('https://hooks.slack.com')
    .post(/.*/)
    .reply(200, 'ok');
}

// Usage in tests
beforeEach(() => {
  mockSlackAPI();
});
```

### Mock AWS Services (LocalStack)

Already configured in `docker-compose.local.yml`

### Mock External APIs

```typescript
// tests/mocks/github.ts
import nock from 'nock';

export function mockGitHubAPI() {
  nock('https://api.github.com')
    .get('/repos/llamandcoco/test')
    .reply(200, { name: 'test' });
}
```

## Debugging

### Debug Lambda Locally

```bash
# Add debugger
# src/router/index.ts
debugger; // <-- Add breakpoint

# Run with Node inspector
node --inspect node_modules/.bin/jest --runInBand
```

### Debug LocalStack

```bash
# View LocalStack logs
docker-compose logs -f localstack

# Execute commands inside container
docker-compose exec localstack bash

# Check resources
awslocal sqs list-queues
awslocal events list-rules --event-bus-name laco-local-chatbot
```

### Debug Slack Webhooks

```bash
# Use ngrok inspector
# Open: http://127.0.0.1:4040

# View all requests/responses in browser
```

## Performance Testing

### Load Test Router

```bash
# Install k6
brew install k6

# Run load test
k6 run tests/load/router-load.js
```

**tests/load/router-load.js:**
```javascript
import http from 'k6/http';

export default function () {
  const payload = 'command=/echo&text=load-test';
  
  http.post('http://localhost:3000/slack/commands', payload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
}

export const options = {
  vus: 10,        // 10 virtual users
  duration: '30s' // 30 seconds
};
```

## CI/CD Testing

The CI pipeline runs:
1. **Lint**: ESLint + TypeScript
2. **Unit Tests**: Jest
3. **Integration Tests**: LocalStack
4. **Build**: Compile + Package
5. **Upload**: S3 artifacts

Local equivalent:
```bash
# Run all CI checks locally
npm run ci

# Or step by step
npm run lint
npm run type-check
npm run test:coverage
npm run build
```

## Troubleshooting

### LocalStack not starting
```bash
# Check Docker
docker ps

# Restart
docker-compose down
docker-compose up -d

# Check logs
docker-compose logs localstack
```

### Tests failing
```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Jest cache
npm run test -- --clearCache
```

### Ngrok issues
```bash
# Get new URL
ngrok http 3000

# Update Slack app
# Copy new URL to Slack app settings
```

## Best Practices

1. **Write tests before code** (TDD)
2. **Mock external services** (Slack, GitHub, etc.)
3. **Test error cases** (not just happy path)
4. **Use factories** for test data
5. **Keep tests fast** (< 5 seconds total)
6. **Test locally before pushing** (CI is not a test environment)

## Next Steps

After local testing passes:
1. Push to GitHub
2. CI runs automatically
3. On success, CD deploys to AWS
4. Test in real platform environment
5. Monitor CloudWatch logs
