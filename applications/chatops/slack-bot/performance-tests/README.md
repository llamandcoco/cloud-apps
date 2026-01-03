# Slack Bot Performance Testing

End-to-end performance testing for the Slack bot architecture using Artillery.

## Quick Start

```bash
# Run full performance test
make perf-test

# Run quick 2-minute test
make perf-test-quick

# Generate HTML report from latest test
make perf-test-report
```

## Prerequisites

1. **AWS Credentials** - Configured with access to:
   - SSM Parameter Store (to fetch Slack signing secret)
   - API Gateway endpoint

2. **Slack Signing Secret** - Must be stored in SSM:
   ```
   /laco/plt/aws/secrets/slack/signing-secret
   ```

3. **API Gateway URL** - Full URL including path, auto-detected from Terragrunt, or set manually:
   ```bash
   make perf-test API_GATEWAY_URL=https://xxx.execute-api.ca-central-1.amazonaws.com/prod/slack
   ```

## Test Scenarios

The Artillery test runs through 5 phases:

1. **Warm-up** (60s @ 2 req/s)
   - Ensures Lambda functions are warm
   - Prevents cold start bias

2. **Ramp-up** (180s, 5 → 20 req/s)
   - Gradually increases load
   - Tests auto-scaling behavior

3. **Sustained Load** (300s @ 20 req/s)
   - Steady-state performance
   - Establishes baseline metrics

4. **High Load** (120s, 20 → 45 req/s)
   - Approaches API Gateway throttle limit (50 req/s)
   - Tests behavior under stress

5. **Cool-down** (60s @ 5 req/s)
   - Allows system to stabilize

**Total Duration:** ~12 minutes

## Command Distribution

Matches realistic usage patterns:

- `/echo` (40%) - Fast command, minimal processing
- `/status` (30%) - Medium complexity, service checks
- `/deploy` (20%) - Slower, deployment simulation
- `/build` (10%) - Slower, GitHub API integration

## Performance Thresholds

Tests fail if any threshold is exceeded:

- **Error Rate:** < 1%
- **P95 Latency:** < 3000ms (3 seconds)
- **P99 Latency:** < 5000ms (5 seconds)

## Output

### Console Output

Real-time statistics during the test:
```
Scenarios launched: 1234
Scenarios completed: 1200
Requests completed: 1200
Mean response/sec: 19.2
Response time (msec):
  min: 245
  max: 4521
  median: 892
  p95: 2134
  p99: 3456
```

### JSON Results

Saved to `performance-tests/results/test-YYYYMMDD-HHMMSS.json`

Contains:
- Request/response timings
- Error counts and types
- Percentile distributions
- Phase-by-phase breakdown

### HTML Report

Generate with: `make perf-test-report`

Includes:
- Interactive charts
- Timeline view
- Request distribution graphs
- Error analysis

## Interpreting Results

### Key Metrics to Watch

1. **P95/P99 Latency**
   - Target: < 3000ms / < 5000ms
   - High values indicate bottlenecks

2. **Error Rate**
   - Target: < 1%
   - Errors by status code:
     - 429: API Gateway throttling
     - 500: Lambda errors
     - 503: Service unavailable

3. **Response Time Distribution**
   - Should follow command complexity:
     - Echo: 500-1000ms
     - Status: 1000-2000ms
     - Deploy/Build: 2000-3000ms

### Common Issues

#### High P95/P99 Latency

**Symptoms:**
- P99 > 5000ms
- Wide gap between median and P99

**Possible Causes:**
- Cold starts
- Worker concurrency limits (5 concurrent)
- Queue backlog

**Investigation:**
1. Check CloudWatch Lambda concurrent executions
2. Check SQS queue depth during test
3. Review X-Ray traces for slow subsegments

#### API Gateway Throttling (429 errors)

**Symptoms:**
- 429 status codes
- Errors during high-load phase

**Root Cause:**
- Default 50 req/s throttle limit exceeded

**Solutions:**
- Request quota increase
- Reduce test load
- Implement request queuing

#### Lambda Errors (500/502/503)

**Symptoms:**
- 5xx status codes
- Errors in specific commands

**Investigation:**
1. Check CloudWatch Logs for Lambda errors
2. Review error messages in Artillery output
3. Check Lambda timeout configuration

## Advanced Usage

### Custom Test Duration

Edit `artillery-config.yml` phases:

```yaml
phases:
  - duration: 120  # 2 minutes instead of default
    arrivalRate: 10
```

### Test Single Command

Create custom scenario file:

```yaml
# artillery-echo-only.yml
config:
  target: "{{ $processEnvironment.API_GATEWAY_URL }}"
  phases:
    - duration: 60
      arrivalRate: 20
  processor: "./slack-signature-processor.js"

scenarios:
  - name: "Echo Only"
    flow:
      - post:
          url: "/slack"
          beforeRequest: "generateSlackSignature"
          body: "token=test&command=/echo&text=test&..."
```

Run: `artillery run artillery-echo-only.yml`

### Different Environment

```bash
# Test against dev environment
make perf-test ENVIRONMENT=dev

# Test against production (careful!)
make perf-test ENVIRONMENT=prd
```

### Manual Artillery Run

```bash
# Set environment variables
export API_GATEWAY_URL="https://xxx.execute-api.ca-central-1.amazonaws.com"
export ENVIRONMENT="plt"
export AWS_REGION="ca-central-1"

# Run test
cd performance-tests
artillery run artillery-config.yml --output results/test.json

# Generate HTML report
node render-report.js results/test.json results/report.html
#
# Or from repo root:
# make perf-test-report REPORT_JSON=performance-tests/results/test.json
```
Note: The report uses Chart.js from a CDN, so charts require network access when viewing.

## Monitoring During Tests

### CloudWatch Dashboard

Monitor in real-time:
```
https://console.aws.amazon.com/cloudwatch/home?region=ca-central-1#dashboards:name=SlackBot-Performance-PLT
```

### CloudWatch Logs Insights

Query during test:

```sql
fields @timestamp, correlationId, e2eLatency, component
| filter component = "echo-worker"
| stats avg(e2eLatency) as avg, percentile(e2eLatency, 95) as p95 by bin(1m)
```

### X-Ray Service Map

View distributed trace:
```
https://console.aws.amazon.com/xray/home?region=ca-central-1#/service-map
```

## Baseline Performance

Establish baseline before architectural changes:

```bash
# Run full test
make perf-test

# Generate report
make perf-test-report

# Archive results
cp performance-tests/results/test-*.json baseline-YYYYMMDD.json
```

Compare before/after:
1. P50/P95/P99 latencies
2. Error rates
3. Throughput (req/s)
4. Resource utilization

## Troubleshooting

### "Failed to fetch Slack signing secret from SSM"

**Solution:**
```bash
# Verify secret exists
aws ssm get-parameter \
  --name /laco/plt/aws/secrets/slack/signing-secret \
  --with-decryption \
  --region ca-central-1

# Check AWS credentials
aws sts get-caller-identity
```

### "Could not get API Gateway URL from Terragrunt"

**Solution:**
```bash
# Get URL manually
cd ../../../../cloud-sandbox/aws/10-plt/slack-api-gateway
terragrunt output api_gateway_url

# Set manually
make perf-test API_GATEWAY_URL=https://xxx.execute-api.ca-central-1.amazonaws.com
```

### "Artillery command not found"

**Solution:**
```bash
# Install globally
npm install -g artillery

# Or use npx
npx artillery run artillery-config.yml
```

### High error rate during test

**Check:**
1. Is the PLT environment healthy?
2. Are Lambdas deployed?
3. Is Slack signing secret correct?
4. Are EventBridge rules configured?
5. Are SQS queues created?

```bash
# Verify stack health
cd ../../../../cloud-sandbox/aws/10-plt
terragrunt run-all output
```

## Files

```
performance-tests/
├── README.md                      # This file
├── artillery-config.yml           # Main Artillery configuration
├── slack-signature-processor.js   # Slack signature generation
└── results/                       # Test results (gitignored)
    ├── test-YYYYMMDD-HHMMSS.json  # Raw test data
    └── report-YYYYMMDD-HHMMSS.html # HTML report
```

## Next Steps

After establishing baseline with Artillery:

1. **Component Testing** - Test individual components with AWS SDK
2. **Identify Bottlenecks** - Compare Artillery E2E vs component latencies
3. **Optimize** - Focus on slowest components
4. **Re-test** - Validate improvements with Artillery
5. **Production Monitoring** - Set up CloudWatch alarms based on baselines

## References

- [Artillery Documentation](https://www.artillery.io/docs)
- [Performance Testing Guide](/cloud-control-plane/docs/guides/performance-testing-guide.md)
- [Slack Bot Architecture](/cloud-control-plane/docs/architecture/)
