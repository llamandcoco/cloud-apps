# Multi-Cloud Adapter Pattern

This guide explains how to implement and extend multi-cloud support in platform applications.

## Architecture Overview

**AWS is the central control plane. Other clouds are execution targets.**

```
┌─────────────────────────────────────┐
│      AWS (Control Plane)            │
│                                      │
│  ┌────────────────────────────┐     │
│  │  ChatOps / Automation      │     │
│  │  (Lambda)                  │     │
│  └──────────┬─────────────────┘     │
│             │                        │
│             ▼                        │
│  ┌────────────────────────────┐     │
│  │  Cloud Executor            │     │
│  │  (Lambda)                  │     │
│  └──────────┬─────────────────┘     │
│             │                        │
└─────────────┼────────────────────────┘
              │
      ┌───────┴───────┐
      ▼               ▼
  ┌────────┐      ┌────────┐
  │  GCP   │      │ Azure  │
  │Adapter │      │Adapter │
  └────────┘      └────────┘
```

## Core Principle

**Do NOT duplicate applications per cloud.**

Instead:
- Single application codebase
- Cloud-specific logic in adapters
- Standard interface for all clouds
- Easy to add new clouds

## Adapter Interface

All cloud adapters implement the same interface:

```typescript
// TypeScript/Node.js
interface CloudExecutor {
  execute(intent: OperationIntent): Promise<OperationResult>;
  validateAccess(): Promise<boolean>;
  getMetadata(): CloudMetadata;
}
```

```python
# Python
from abc import ABC, abstractmethod

class CloudExecutor(ABC):
    @abstractmethod
    async def execute(self, intent: dict) -> dict:
        pass
    
    @abstractmethod
    async def validate_access(self) -> bool:
        pass
    
    @abstractmethod
    def get_metadata(self) -> dict:
        pass
```

```go
// Go
type CloudExecutor interface {
    Execute(ctx context.Context, intent Intent) (*OperationResult, error)
    ValidateAccess(ctx context.Context) error
    GetMetadata() CloudMetadata
}
```

## Intent Structure

Operations are represented as intent objects:

```typescript
interface OperationIntent {
  id: string;
  operation: string;              // e.g., "create_vm", "list_instances"
  parameters: Record<string, any>;
  requestedBy: string;
  requestedAt: string;
  cloud: 'aws' | 'gcp' | 'azure';
  callbackUrl?: string;
}
```

## Implementing an Adapter

### Step 1: Implement the Interface

#### AWS Adapter (Example)

```typescript
// runtime/adapters/aws-adapter.ts
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';

export class AWSExecutor implements CloudExecutor {
  private ec2: EC2Client;

  constructor() {
    this.ec2 = new EC2Client({});
  }

  async execute(intent: OperationIntent): Promise<OperationResult> {
    switch (intent.operation) {
      case 'list-instances':
        return this.listInstances(intent.parameters);
      case 'create-vm':
        return this.createVM(intent.parameters);
      default:
        throw new Error(`Unknown operation: ${intent.operation}`);
    }
  }

  async validateAccess(): Promise<boolean> {
    // Verify AWS credentials
    const sts = new STSClient({});
    await sts.send(new GetCallerIdentityCommand({}));
    return true;
  }

  getMetadata(): CloudMetadata {
    return {
      provider: 'aws',
      region: process.env.AWS_REGION || 'us-east-1',
      version: '1.0.0'
    };
  }

  private async listInstances(params: any): Promise<OperationResult> {
    const result = await this.ec2.send(new DescribeInstancesCommand({}));
    // Process result...
    return { status: 'success', data: { instances: [] } };
  }

  private async createVM(params: any): Promise<OperationResult> {
    // Create EC2 instance...
    return { status: 'success', data: { instanceId: 'i-123' } };
  }
}
```

#### GCP Adapter (Example)

```typescript
// runtime/adapters/gcp-adapter.ts
import { Compute } from '@google-cloud/compute';
import { getSecret } from '../shared/secrets';

export class GCPExecutor implements CloudExecutor {
  private compute: Compute;

  constructor() {
    // Credentials fetched at runtime from Parameter Store
    this.compute = null!; // Initialize in init()
  }

  async init(): Promise<void> {
    // ✅ SECURITY: Fetch credentials at runtime
    const credentials = await getSecret('/app/production/gcp-credentials');
    this.compute = new Compute({
      credentials: JSON.parse(credentials)
    });
  }

  async execute(intent: OperationIntent): Promise<OperationResult> {
    await this.init(); // Ensure initialized

    switch (intent.operation) {
      case 'list-instances':
        return this.listInstances(intent.parameters);
      case 'create-vm':
        return this.createVM(intent.parameters);
      default:
        throw new Error(`Unknown operation: ${intent.operation}`);
    }
  }

  async validateAccess(): Promise<boolean> {
    await this.init();
    // Test API call to verify credentials
    return true;
  }

  getMetadata(): CloudMetadata {
    return {
      provider: 'gcp',
      region: 'us-central1',
      version: '1.0.0'
    };
  }

  private async listInstances(params: any): Promise<OperationResult> {
    const [instances] = await this.compute.getVMs();
    return {
      status: 'success',
      data: {
        instances: instances.map(i => i.name)
      }
    };
  }

  private async createVM(params: any): Promise<OperationResult> {
    const zone = this.compute.zone('us-central1-a');
    const [vm, operation] = await zone.createVM('new-instance', {
      machineType: params.machineType || 'e2-micro'
    });
    
    return {
      status: 'success',
      data: {
        instance: vm.name,
        status: 'PROVISIONING'
      }
    };
  }
}
```

### Step 2: Register Adapter

Add the adapter to the executor selector:

```typescript
// runtime/handlers/executor/index.ts
import { AWSExecutor } from '../../adapters/aws-adapter';
import { GCPExecutor } from '../../adapters/gcp-adapter';
import { AzureExecutor } from '../../adapters/azure-adapter';

function getExecutor(cloud: string): CloudExecutor {
  switch (cloud) {
    case 'aws':
      return new AWSExecutor();
    case 'gcp':
      return new GCPExecutor();
    case 'azure':
      return new AzureExecutor();
    default:
      throw new Error(`Unknown cloud: ${cloud}`);
  }
}

export async function handler(event: any) {
  const intent: OperationIntent = JSON.parse(event.body);
  
  // Select adapter
  const executor = getExecutor(intent.cloud);
  
  // Execute with standard interface
  const result = await executor.execute(intent);
  
  return { statusCode: 200, body: JSON.stringify(result) };
}
```

### Step 3: Add Credentials

Store cloud credentials in Parameter Store:

```bash
# GCP service account
aws ssm put-parameter \
  --name /app/production/gcp-credentials \
  --value "$(cat gcp-service-account.json)" \
  --type SecureString

# Azure credentials
aws ssm put-parameter \
  --name /app/production/azure-credentials \
  --value "$(cat azure-credentials.json)" \
  --type SecureString
```

### Step 4: Grant IAM Permissions

Update CDK to grant access to cloud credentials:

```typescript
// infrastructure/lib/stack.ts
executorHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:*:*:parameter/app/production/gcp-credentials`,
    `arn:aws:ssm:*:*:parameter/app/production/azure-credentials`
  ]
}));
```

## Adding a New Cloud Provider

To add support for a new cloud (e.g., DigitalOcean):

### 1. Implement CloudExecutor

```typescript
// runtime/adapters/digitalocean-adapter.ts
export class DigitalOceanExecutor implements CloudExecutor {
  async execute(intent: OperationIntent): Promise<OperationResult> {
    // Fetch DO credentials
    const token = await getSecret('/app/production/do-token');
    
    // Use DigitalOcean SDK
    // ...
  }

  async validateAccess(): Promise<boolean> {
    // Verify token
    return true;
  }

  getMetadata(): CloudMetadata {
    return {
      provider: 'digitalocean',
      region: 'nyc3',
      version: '1.0.0'
    };
  }
}
```

### 2. Register Adapter

```typescript
case 'digitalocean':
  return new DigitalOceanExecutor();
```

### 3. Add Credentials

```bash
aws ssm put-parameter \
  --name /app/production/do-token \
  --value "your-do-token" \
  --type SecureString
```

### 4. Grant IAM

```typescript
executorHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [`arn:aws:ssm:*:*:parameter/app/production/do-token`]
}));
```

### 5. Test

```bash
# Test intent
{
  "id": "test-123",
  "operation": "list-instances",
  "cloud": "digitalocean",
  "parameters": {},
  "requestedBy": "user123",
  "requestedAt": "2024-01-01T00:00:00Z"
}
```

## Testing Adapters

Each adapter should be testable in isolation:

```typescript
// tests/adapters/gcp-adapter.test.ts
import { GCPExecutor } from '../../runtime/adapters/gcp-adapter';

describe('GCPExecutor', () => {
  it('should list instances', async () => {
    const executor = new GCPExecutor();
    
    const intent: OperationIntent = {
      id: 'test-1',
      operation: 'list-instances',
      parameters: {},
      requestedBy: 'test',
      requestedAt: new Date().toISOString(),
      cloud: 'gcp'
    };
    
    const result = await executor.execute(intent);
    
    expect(result.status).toBe('success');
    expect(result.data).toHaveProperty('instances');
  });
});
```

## Common Operations

Standard operations supported by all adapters:

| Operation | Description | Parameters |
|-----------|-------------|------------|
| `list-instances` | List VMs/instances | `{ region?: string }` |
| `create-vm` | Create a VM | `{ machineType: string, zone?: string }` |
| `delete-vm` | Delete a VM | `{ instanceId: string }` |
| `start-vm` | Start a stopped VM | `{ instanceId: string }` |
| `stop-vm` | Stop a running VM | `{ instanceId: string }` |
| `list-buckets` | List storage buckets | `{}` |
| `create-bucket` | Create storage bucket | `{ name: string, region?: string }` |

## Best Practices

1. **Keep adapters thin**: Business logic belongs in the core application, not adapters
2. **Use standard interfaces**: All clouds should support the same operations
3. **Handle cloud-specific features gracefully**: If GCP has a feature AWS doesn't, make it optional
4. **Test in isolation**: Each adapter should have its own tests
5. **Document cloud-specific parameters**: Some operations may have cloud-specific options

## Error Handling

Adapters should return consistent error formats:

```typescript
{
  status: 'error',
  message: 'Human-readable error message',
  error: 'OPERATION_FAILED',
  errorDetails: {
    cloud: 'gcp',
    operation: 'create-vm',
    reason: 'Quota exceeded'
  }
}
```

## Monitoring

Each adapter execution is logged:

```json
{
  "level": "INFO",
  "message": "Executing operation",
  "cloud": "gcp",
  "operation": "create-vm",
  "intentId": "intent-123",
  "duration": 1234
}
```

## Cost Considerations

- **Lambda execution time**: Multi-cloud operations may be slower than native AWS
- **API calls**: Each cloud provider charges for API calls
- **Data transfer**: Cross-cloud data transfer can be expensive

Monitor costs per cloud provider using CloudWatch metrics.

## Security

- Credentials stored in Parameter Store (encrypted)
- IAM policies restrict access per application
- CloudTrail logs all credential access
- No credentials in code or environment variables

## Questions?

For more information, see:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- Example: [applications/chatops/slack-bot/runtime/adapters/](../applications/chatops/slack-bot/runtime/adapters/)
