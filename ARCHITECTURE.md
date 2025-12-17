# Architecture Decision Records

This document explains the architectural decisions behind the platform applications repository.

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [Infrastructure Language: TypeScript](#infrastructure-language-typescript)
3. [Runtime Language: Flexible](#runtime-language-flexible)
4. [Secret Management: Runtime Retrieval](#secret-management-runtime-retrieval)
5. [Multi-Cloud Strategy](#multi-cloud-strategy)
6. [Execution Model](#execution-model)
7. [Shared Logic](#shared-logic)

---

## Repository Structure

### Decision

Applications are grouped by **category** (chatops, automation, services) for organization only. Each application is an **independent deployment unit**.

### Rationale

**Why category grouping?**
- Improves readability and navigation
- Provides logical organization for contributors
- Groups similar applications together

**Why NOT use categories as deployment boundaries?**
- Applications have different deployment schedules
- Independent CI/CD per app enables faster iteration
- Reduces blast radius of changes
- Allows different teams to own different apps
- Avoids monolithic deployment patterns

**Why NOT use environment-based structure?**
- Applications, not environments, are the primary boundary
- CDK handles multi-environment deployment via context
- Environment-based structure duplicates code
- Single application codebase can deploy to any environment

### Example

```
applications/
├── chatops/              # Category (organization only)
│   ├── slack-bot/        # Independent deployment unit
│   └── terraform-bot/    # Independent deployment unit
├── automation/           # Category (organization only)
│   ├── cost-reporter/    # Independent deployment unit
│   └── infra-auditor/    # Independent deployment unit
```

Each application deploys independently:

```bash
# Deploy only slack-bot to production
cd applications/chatops/slack-bot/infrastructure
npx cdk deploy -c environment=production

# Deploy only cost-reporter to staging
cd applications/automation/cost-reporter/infrastructure
npx cdk deploy -c environment=staging
```

---

## Infrastructure Language: TypeScript

### Decision

All infrastructure code uses **AWS CDK with TypeScript**. This is enforced, not flexible.

### Rationale

**Consistency:**
- Single language for all infrastructure definitions
- Standard patterns across applications
- Easier for platform engineers to review and maintain

**Type Safety:**
- Compile-time validation of infrastructure
- IDE autocomplete and inline documentation
- Catch errors before deployment

**Ecosystem:**
- Rich CDK construct library
- Strong TypeScript tooling (ESLint, Prettier, Jest)
- Large community and examples

**Ownership:**
- Platform engineers own CDK infrastructure
- Clear responsibility for security and IAM policies
- Infrastructure code is reviewed by security-aware team

**NOT Python, NOT Go:**
- Prevents fragmentation of infrastructure patterns
- Avoids "every app uses different CDK language" problem
- TypeScript is the most mature CDK language

### Flexibility

**What if a team doesn't know TypeScript?**

CDK infrastructure is **declarative and template-based**. Teams can:
1. Copy infrastructure from similar applications
2. Use standard patterns from `shared/cdk-constructs/`
3. Request help from platform team for complex cases

The infrastructure surface area is small compared to runtime code. Most changes are in runtime handlers, not CDK stacks.

### Example

```typescript
// infrastructure/lib/stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaPython from '@aws-cdk/aws-lambda-python-alpha';

export class SlackBotStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Define Node.js Lambda
    new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../../runtime/handlers/slack-handler')
    });

    // Define Python Lambda
    new lambdaPython.PythonFunction(this, 'Processor', {
      runtime: lambda.Runtime.PYTHON_3_12,
      entry: '../../runtime/handlers/processor',
      index: 'main.py',
      handler: 'handler'
    });
  }
}
```

---

## Runtime Language: Flexible

### Decision

Lambda function runtime languages are **chosen per application** based on requirements. Common choices: Node.js, Python, Go.

### Rationale

**Different Applications, Different Needs:**

- **Node.js**: Fast startup, rich AWS SDK, good for API integrations and I/O-bound tasks
- **Python**: Excellent for data processing, ML, scientific computing, large library ecosystem
- **Go**: High performance, low memory, ideal for compute-intensive tasks

**Examples:**

| Application | Runtime | Why |
|------------|---------|-----|
| Slack Bot | Node.js | Rich Slack SDK, async I/O, fast iteration |
| Cost Reporter | Python | AWS Cost Explorer SDK, Pandas for data manipulation |
| Terraform Executor | Go | Fast startup, low memory, CLI tool execution |
| Image Processor | Python | PIL/Pillow library, scientific computing |

**Independence from Infrastructure:**

CDK abstracts runtime differences:

```typescript
// TypeScript CDK defines ANY runtime
new lambda.Function(this, 'NodeHandler', {
  runtime: lambda.Runtime.NODEJS_20_X,  // Node.js
  // ...
});

new lambda.Function(this, 'PythonHandler', {
  runtime: lambda.Runtime.PYTHON_3_12,  // Python
  // ...
});

new lambda.Function(this, 'GoHandler', {
  runtime: lambda.Runtime.PROVIDED_AL2023,  // Go (custom runtime)
  // ...
});
```

The infrastructure team doesn't need to know Python or Go to define the Lambda resources.

**No Impact on Deployment:**

- All Lambdas deploy via CDK (same process)
- Same IAM patterns regardless of runtime
- Same monitoring and observability
- Same CI/CD pipeline

### Constraints

**Shared code between handlers in different languages?**

Use APIs, not libraries:
- Expose shared logic as an MCP server or REST API
- Language-agnostic interface
- Versioned and independently deployable

**When to use which runtime?**

| Use Case | Recommended Runtime |
|----------|---------------------|
| API integrations, webhooks | Node.js |
| Data processing, analytics | Python |
| High-performance, low-latency | Go |
| ML/AI inference | Python |
| CLI tool execution | Go |

---

## Secret Management: Runtime Retrieval

### Decision

Secrets are **NEVER injected at deploy time**. They are **fetched at runtime** using IAM-based access to Parameter Store or Secrets Manager.

### Rationale

See [SECURITY.md](SECURITY.md) for comprehensive security rationale.

**Key Points:**

1. **Secrets don't appear in CloudFormation**: Safe for public repositories, audit logs, console access
2. **Rotation without redeployment**: Update secrets in Parameter Store, Lambda picks up new value immediately
3. **IAM enforcement**: Knowledge of parameter name is useless without IAM permission
4. **Audit trail**: CloudTrail logs every secret access with full context
5. **Encryption**: KMS encryption at rest, TLS in transit

### Pattern

**Infrastructure (CDK):**

```typescript
const handler = new lambda.Function(this, 'Handler', {
  environment: {
    CONFIG_PROFILE: 'production'  // Non-sensitive selector only
  }
});

// Grant runtime access
handler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [`arn:aws:ssm:*:*:parameter/slack-bot/production/*`]
}));
```

**Runtime (any language):**

```typescript
// Node.js
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
const token = await ssm.send(new GetParameterCommand({
  Name: '/slack-bot/production/token',
  WithDecryption: true
}));
```

```python
# Python
import boto3

ssm = boto3.client('ssm')
response = ssm.get_parameter(
    Name='/slack-bot/production/token',
    WithDecryption=True
)
token = response['Parameter']['Value']
```

```go
// Go
import "github.com/aws/aws-sdk-go/service/ssm"

svc := ssm.New(session.New())
param, _ := svc.GetParameter(&ssm.GetParameterInput{
    Name:           aws.String("/slack-bot/production/token"),
    WithDecryption: aws.Bool(true),
})
token := *param.Parameter.Value
```

---

## Multi-Cloud Strategy

### Decision

**AWS is the central control plane.** Other clouds (GCP, Azure) are **execution targets** accessed via adapters.

### Rationale

**Why AWS as control plane?**
- Existing AWS expertise and infrastructure
- Rich Lambda ecosystem for event-driven architecture
- Unified IAM and secret management
- Cost-effective for control-plane workloads

**Why NOT duplicate applications per cloud?**
- Code duplication and drift
- Multiple deployment pipelines to maintain
- Inconsistent behavior across clouds
- Higher maintenance burden

**Why adapter pattern?**
- Cloud-specific logic is isolated
- Standard interface for all cloud providers
- Easy to add new clouds without changing core logic
- Testable in isolation

### Architecture

```
┌─────────────────────────────────────────┐
│         AWS (Control Plane)              │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │  ChatOps Handler (Lambda)         │   │
│  │  - Receives Slack command         │   │
│  │  - Validates & authorizes         │   │
│  │  - Selects cloud adapter          │   │
│  └──────────────────────────────────┘   │
│              │                           │
│              ▼                           │
│  ┌──────────────────────────────────┐   │
│  │  Cloud Executor (Lambda)          │   │
│  │  - Loads cloud adapter            │   │
│  │  - Executes operation             │   │
│  └──────────────────────────────────┘   │
│       │            │            │        │
└───────┼────────────┼────────────┼────────┘
        │            │            │
        ▼            ▼            ▼
   ┌────────┐  ┌─────────┐  ┌─────────┐
   │  AWS   │  │   GCP   │  │  Azure  │
   │Adapter │  │ Adapter │  │ Adapter │
   └────────┘  └─────────┘  └─────────┘
```

### Implementation

**Cloud Adapter Interface:**

```typescript
// runtime/shared/cloud-adapter.ts
export interface CloudExecutor {
  /** Execute infrastructure operation */
  execute(intent: OperationIntent): Promise<OperationResult>;
  
  /** Validate credentials and permissions */
  validateAccess(): Promise<boolean>;
  
  /** Get cloud-specific metadata */
  getMetadata(): CloudMetadata;
}

export interface OperationIntent {
  operation: string;      // e.g., "create_vm", "list_buckets"
  parameters: Record<string, any>;
  requestedBy: string;
  cloud: 'aws' | 'gcp' | 'azure';
}
```

**AWS Adapter:**

```typescript
// runtime/adapters/aws-adapter.ts
export class AWSExecutor implements CloudExecutor {
  async execute(intent: OperationIntent): Promise<OperationResult> {
    // Use AWS SDK
    const ec2 = new EC2Client({});
    // ...
  }
}
```

**GCP Adapter:**

```typescript
// runtime/adapters/gcp-adapter.ts
import { Compute } from '@google-cloud/compute';

export class GCPExecutor implements CloudExecutor {
  async execute(intent: OperationIntent): Promise<OperationResult> {
    // Fetch GCP credentials from Parameter Store
    const credentials = await getSecret('/gcp/service-account-key');
    
    // Use GCP SDK
    const compute = new Compute({ credentials: JSON.parse(credentials) });
    // ...
  }
}
```

**Adapter Selection:**

```typescript
// runtime/handlers/executor/index.ts
import { AWSExecutor } from '../../adapters/aws-adapter';
import { GCPExecutor } from '../../adapters/gcp-adapter';
import { AzureExecutor } from '../../adapters/azure-adapter';

export async function handler(event: any) {
  const intent: OperationIntent = JSON.parse(event.body);
  
  // Select adapter based on intent
  const executor = getExecutor(intent.cloud);
  
  // Execute with standard interface
  const result = await executor.execute(intent);
  return result;
}

function getExecutor(cloud: string): CloudExecutor {
  switch (cloud) {
    case 'aws': return new AWSExecutor();
    case 'gcp': return new GCPExecutor();
    case 'azure': return new AzureExecutor();
    default: throw new Error(`Unknown cloud: ${cloud}`);
  }
}
```

### Adding a New Cloud

1. Implement `CloudExecutor` interface in `runtime/adapters/new-cloud-adapter.ts`
2. Add cloud selection in executor handler
3. Add cloud-specific secrets to Parameter Store
4. Grant IAM permissions for secret access
5. Test in isolation

**No changes to:**
- ChatOps handlers
- CDK infrastructure
- CI/CD pipelines
- Other adapters

---

## Execution Model

### Decision

**Control-plane applications delegate long-running operations to workers.**

ChatOps handlers:
- Receive and validate commands
- Translate to intent objects
- Enqueue for async execution
- Respond immediately to user

Workers:
- Dequeue intents
- Execute long-running operations
- Report results

### Rationale

**Separation of Concerns:**
- Control logic separate from execution logic
- ChatOps handler is fast and responsive
- Workers can be scaled independently
- Failures in execution don't crash control plane

**User Experience:**
- Immediate feedback ("Command received, executing...")
- Status updates via callbacks
- Async execution doesn't block Slack

**Security:**
- Control plane validates and authorizes
- Workers execute with least-privilege IAM
- Clear audit trail of who requested what

**Scalability:**
- Workers can be scaled based on queue depth
- Control plane remains lightweight
- Long-running operations don't timeout

### Architecture

```
User (Slack) ──┐
               │
               ▼
       ┌───────────────┐
       │ ChatOps       │
       │ Handler       │  (validates, creates intent)
       │ (Lambda)      │
       └───────┬───────┘
               │
               ▼
       ┌───────────────┐
       │   SQS Queue   │
       └───────┬───────┘
               │
               ▼
       ┌───────────────┐
       │  Executor     │  (fetches intent, executes)
       │  Worker       │
       │  (Lambda)     │
       └───────┬───────┘
               │
               ▼
       ┌───────────────┐
       │ Cloud API     │
       │ (AWS/GCP/etc) │
       └───────────────┘
```

### Implementation

**Intent Definition:**

```typescript
// runtime/shared/types.ts
export interface Intent {
  id: string;
  operation: string;
  parameters: Record<string, any>;
  requestedBy: string;
  requestedAt: string;
  cloud: 'aws' | 'gcp' | 'azure';
  callbackUrl?: string;  // For status updates
}
```

**ChatOps Handler (Control):**

```typescript
// runtime/handlers/chatops/index.ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

export async function handler(event: SlackEvent) {
  // Parse command
  const command = parseSlackCommand(event.body);
  
  // Validate and authorize
  if (!isAuthorized(event.userId, command.operation)) {
    return { statusCode: 403, body: 'Unauthorized' };
  }
  
  // Create intent
  const intent: Intent = {
    id: generateId(),
    operation: command.operation,
    parameters: command.parameters,
    requestedBy: event.userId,
    requestedAt: new Date().toISOString(),
    cloud: command.cloud,
    callbackUrl: event.responseUrl
  };
  
  // Enqueue for execution
  const sqs = new SQSClient({});
  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.INTENT_QUEUE_URL,
    MessageBody: JSON.stringify(intent)
  }));
  
  // Respond immediately
  return {
    statusCode: 200,
    body: JSON.stringify({
      text: `Command received! Executing ${command.operation}...`,
      response_type: 'in_channel'
    })
  };
}
```

**Executor Worker:**

```typescript
// runtime/handlers/executor/index.ts
export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const intent: Intent = JSON.parse(record.body);
    
    try {
      // Select and execute
      const executor = getExecutor(intent.cloud);
      const result = await executor.execute(intent);
      
      // Report success
      if (intent.callbackUrl) {
        await reportStatus(intent.callbackUrl, {
          status: 'completed',
          result
        });
      }
    } catch (error) {
      // Report failure
      if (intent.callbackUrl) {
        await reportStatus(intent.callbackUrl, {
          status: 'failed',
          error: error.message
        });
      }
      throw error;  // DLQ will handle
    }
  }
}
```

---

## Shared Logic

### Decision

Shared functionality is exposed via **APIs (e.g., MCP servers)**, NOT in-repo libraries.

### Rationale

**Why NOT shared libraries?**

```
applications/
├── chatops/slack-bot/
│   └── runtime/handlers/
│       └── shared/secrets.ts  ❌ Only usable by Node.js
├── automation/cost-reporter/
    └── runtime/handlers/
        └── shared/secrets.py  ❌ Duplicated logic
```

Problems:
- Language-specific (Node.js code not usable by Python)
- Duplication across apps
- Versioning nightmare
- Tight coupling between applications
- Hard to test in isolation

**Why APIs?**

```
applications/
├── services/mcp-server/      ✅ Shared logic service
│   └── runtime/handlers/
│       ├── secrets.ts        # Exposes /get-secret endpoint
│       └── audit.ts          # Exposes /log-audit endpoint
```

Benefits:
- Language-agnostic (any runtime can call HTTP API)
- Single source of truth
- Versioned API contracts
- Independently deployable and testable
- Clear boundaries between services
- Observable and monitorable

### Example: MCP Server for Secrets

**MCP Server (API):**

```typescript
// applications/services/mcp-server/runtime/handlers/secrets.ts
export async function handler(event: APIGatewayEvent) {
  const { secretName } = JSON.parse(event.body);
  
  // Centralized secret retrieval with caching, logging, etc.
  const secret = await getSecretWithCache(secretName);
  
  return {
    statusCode: 200,
    body: JSON.stringify({ secret })
  };
}
```

**Client (Node.js):**

```typescript
// applications/chatops/slack-bot/runtime/handlers/index.ts
const response = await fetch('https://mcp.example.com/get-secret', {
  method: 'POST',
  body: JSON.stringify({ secretName: '/slack-bot/token' })
});
const { secret } = await response.json();
```

**Client (Python):**

```python
# applications/automation/cost-reporter/runtime/handlers/main.py
import requests

response = requests.post('https://mcp.example.com/get-secret', 
                        json={'secretName': '/cost-reporter/token'})
secret = response.json()['secret']
```

**Client (Go):**

```go
// applications/automation/infra-auditor/runtime/handlers/main.go
import "net/http"

resp, _ := http.Post("https://mcp.example.com/get-secret",
    "application/json",
    bytes.NewBuffer([]byte(`{"secretName":"/auditor/token"}`)))
```

### When to Use APIs vs Libraries

| Use Case | Approach | Why |
|----------|----------|-----|
| Secret retrieval | API (MCP server) | Language-agnostic, centralized caching |
| Audit logging | API (MCP server) | Centralized storage, consistent format |
| Cloud adapters | Library (within app) | Performance, no network overhead |
| Type definitions | Shared types package | Development-time only, no runtime dependency |
| CDK constructs | Shared constructs | Reusable infrastructure patterns |

---

## Summary

| Decision | Rationale |
|----------|-----------|
| **Applications as deployment units** | Independent iteration, clear boundaries, reduced blast radius |
| **CDK in TypeScript** | Consistency, type safety, clear ownership, prevents fragmentation |
| **Runtime languages flexible** | Different apps have different needs, CDK abstracts differences |
| **Secrets at runtime** | Security, rotation, audit trail, public repository safety |
| **Multi-cloud adapters** | Avoid duplication, standard interface, isolated cloud logic |
| **Intent-based execution** | Separation of concerns, scalability, better UX |
| **APIs not libraries** | Language-agnostic, versioned, independently deployable |

These decisions optimize for:
- **Security**: Secrets never exposed, IAM-based access
- **Scalability**: Independent deployment, async execution
- **Maintainability**: Clear boundaries, standard patterns
- **Flexibility**: Choose right tool for each use case
- **Public repository**: Safe by design, no secrets in code
