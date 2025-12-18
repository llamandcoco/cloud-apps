# Platform Applications

A production-ready repository for cloud-native platform automation, ChatOps, and internal tooling.

## Overview

This repository contains **application-level infrastructure and code** for platform engineering tools and automation. It is designed for public collaboration while maintaining security-first principles.

### What This Repository Contains

- **ChatOps applications** (Slack bots, command handlers)
- **Automation tools** (Terraform bot, cost reporters, audit tools)
- **Internal platform services** (APIs, schedulers, integrations)
- **Multi-cloud execution adapters** (GCP, Azure service wrappers)

### What This Repository Does NOT Contain

- ❌ Base infrastructure (VPC, networking, IAM organization)
- ❌ Terraform modules or organization-wide policies
- ❌ Environment-specific infrastructure stacks
- ❌ Secrets, credentials, or parameter paths

**Base infrastructure is managed elsewhere.** This repository focuses on applications that run on top of that foundation.

## Architecture Principles

### 1. Applications as Deployment Units

Each application is an **independent deployment unit** with:
- Its own CDK stack(s)
- Isolated IAM permissions
- Independent CI/CD pipeline
- Clear ownership boundaries

Categories (e.g., `chatops/`, `automation/`) are for **organization only** — they are NOT deployment, IAM, or CI/CD boundaries.

### 2. Infrastructure Language: TypeScript (CDK)

**All infrastructure is defined using AWS CDK with TypeScript.**

**Why unified CDK language?**
- Consistent infrastructure patterns across all applications
- Type safety and IDE support for infrastructure definitions
- Easier for platform engineers to review and maintain
- Prevents fragmentation of infrastructure tooling
- Clear ownership: platform engineers own CDK, app teams own runtime code

### 3. Runtime Language: Flexible (Node.js, Python, Go)

**Lambda function runtime languages are chosen per application based on need.**

**Why flexible runtime languages?**
- Different applications have different requirements (libraries, performance, team expertise)
- Runtime language choice doesn't affect infrastructure deployment
- CDK abstracts runtime differences through standard constructs
- Teams can use the best tool for their use case
- Example: Python for data processing, Go for performance, Node.js for API integrations

### 4. Security-First: Runtime Secret Retrieval

**Secrets are NEVER injected at deploy time. They are fetched at runtime using IAM.**

**Why runtime secret retrieval?**

**Security:**
- Secrets never appear in CloudFormation templates or deployment logs
- IAM policies enforce least-privilege access at runtime
- Knowledge of a parameter name is useless without IAM permission
- Audit trail via CloudTrail for every secret access
- Safe for public repositories — no secrets in code or config

**Operational:**
- Secrets can be rotated without redeployment
- No environment variables to leak or expose
- Parameter Store provides centralized secret management
- Encryption at rest (KMS) and in transit (TLS)

**Implementation:**
- Environment variables contain ONLY non-sensitive selectors (e.g., `CONFIG_PROFILE=production`)
- Parameter Store paths are hardcoded in application code, not passed from infrastructure
- IAM policies restrict access using path-based conditions

### 5. Multi-Cloud: Control Plane + Execution Adapters

**AWS acts as the central control plane. Other clouds are execution targets.**

- ChatOps commands route through AWS Lambda (control plane)
- Cloud-specific logic is isolated in adapter modules
- Adapters expose standard interfaces (e.g., `CloudExecutor`)
- No application duplication per cloud
- Add new clouds by implementing adapter interface

### 6. Execution Model: Intent-Based Delegation

**Control-plane applications delegate execution to workers.**

- ChatOps handlers translate commands to intent objects
- Intents are enqueued (SQS, EventBridge) for async execution
- Workers execute long-running or risky operations
- Clear separation between routing and execution logic

### 7. Shared Logic: APIs, Not Libraries

**Shared functionality is exposed via APIs (e.g., MCP servers), not in-repo libraries.**

- Language-agnostic interfaces
- Versioned, independently deployable
- Clear API contracts
- No tight coupling between applications

## Repository Structure

```
platform-applications/
├── README.md                      # This file
├── ARCHITECTURE.md                # Detailed architecture decisions
├── SECURITY.md                    # Security guidelines and patterns
├── docs/                          # Documentation
│   ├── getting-started.md
│   ├── deployment.md
│   ├── multi-cloud-adapters.md
│   └── secret-management.md
├── applications/                  # All platform applications
│   ├── chatops/                   # Category: ChatOps tools
│   │   ├── slack-bot/             # Application
│   │   └── terraform-bot/         # Application
│   ├── automation/                # Category: Automation tools
│   │   ├── cost-reporter/         # Application
│   │   └── infra-auditor/         # Application
│   └── services/                  # Category: Platform services
│       └── mcp-server/            # Application
├── shared/                        # Shared utilities (minimal)
│   ├── types/                     # TypeScript type definitions
│   └── cdk-constructs/            # Reusable CDK constructs (L3)
├── .github/                       # GitHub workflows
│   └── workflows/
│       ├── deploy-app.yml         # Reusable deployment workflow
│       └── pr-checks.yml          # PR validation
└── cdk.json                       # CDK configuration
```

## Application Directory Structure

Each application follows this standard structure:

```
applications/category/app-name/
├── README.md                      # Application-specific documentation
├── infrastructure/                # CDK infrastructure (TypeScript)
│   ├── bin/
│   │   └── app.ts                 # CDK app entry point
│   ├── lib/
│   │   ├── stack.ts               # Main CDK stack
│   │   └── constructs/            # Application-specific constructs
│   ├── cdk.json                   # CDK configuration
│   ├── package.json
│   └── tsconfig.json
├── runtime/                       # Application runtime code
│   ├── handlers/                  # Lambda handlers (any language)
│   │   ├── command-handler/       # Node.js example
│   │   │   ├── index.ts
│   │   │   └── package.json
│   │   ├── processor/             # Python example
│   │   │   ├── main.py
│   │   │   └── requirements.txt
│   │   └── executor/              # Go example
│   │       ├── main.go
│   │       └── go.mod
│   └── shared/                    # Shared runtime utilities (within app)
│       └── secrets.ts             # Secret retrieval patterns
├── tests/                         # Tests
│   ├── infrastructure/            # CDK tests
│   └── runtime/                   # Runtime tests
└── .gitignore
```

## Quick Start

### Deploy an Application

```bash
cd applications/chatops/slack-bot/infrastructure
npm install
npx cdk deploy
```

### Add a New Application

1. Copy the template: `cp -r applications/_template applications/category/new-app`
2. Update `README.md` and configuration
3. Implement infrastructure in `infrastructure/lib/stack.ts`
4. Implement runtime logic in `runtime/handlers/`
5. Add secrets to Parameter Store with IAM policies
6. Deploy: `cd infrastructure && npx cdk deploy`

## Security

- All secrets fetched at runtime via IAM
- Parameter Store paths hardcoded in application code
- Least-privilege IAM policies per application
- No secrets in environment variables, code, or CloudFormation
- Public repository safe by design

See [SECURITY.md](SECURITY.md) for detailed security patterns.

## Contributing

This is a public repository. External contributors are welcome!

- Follow the application directory structure
- Use runtime secret retrieval patterns
- Write CDK infrastructure in TypeScript
- Choose appropriate runtime language for your use case
- Add tests for both infrastructure and runtime code

## License

MIT
