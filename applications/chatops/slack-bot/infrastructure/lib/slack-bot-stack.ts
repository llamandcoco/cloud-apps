import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';

export interface SlackBotStackProps extends cdk.StackProps {
  environment: 'staging' | 'production';
}

/**
 * Slack Bot Stack
 * 
 * Demonstrates:
 * - CDK infrastructure in TypeScript
 * - Multi-language Lambda handlers (Node.js, Python, Go)
 * - Secure runtime secret retrieval from Parameter Store
 * - Intent-based execution model with SQS
 * - Multi-cloud adapter pattern
 */
export class SlackBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SlackBotStackProps) {
    super(scope, id, props);

    const envName = props.environment;

    // ========================================================================
    // SQS Queue for Intent-Based Delegation
    // ========================================================================

    // Dead Letter Queue for failed executions
    const dlq = new sqs.Queue(this, 'IntentDLQ', {
      queueName: `slack-bot-${envName}-intent-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.KMS_MANAGED
    });

    // Main intent queue
    const intentQueue = new sqs.Queue(this, 'IntentQueue', {
      queueName: `slack-bot-${envName}-intent-queue`,
      visibilityTimeout: cdk.Duration.seconds(300),
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3
      }
    });

    // ========================================================================
    // IAM Policy for Parameter Store Access
    // ========================================================================

    /**
     * SECURITY PATTERN:
     * 
     * Grant least-privilege access to Parameter Store paths.
     * Each Lambda can only access its own application's secrets.
     * 
     * ✅ GOOD: Path-based restriction
     * ❌ BAD: ssm:* on resource *
     */
    const parameterStorePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath'
      ],
      resources: [
        // Application-specific parameter path
        `arn:aws:ssm:${this.region}:${this.account}:parameter/slack-bot/${envName}/*`
      ],
      conditions: {
        // Additional security: require encryption
        StringEquals: {
          'ssm:Decrypt': 'true'
        }
      }
    });

    // ========================================================================
    // Lambda Handler 1: Command Handler (Node.js)
    // ========================================================================

    /**
     * RUNTIME: Node.js 20
     * PURPOSE: Receive Slack commands, validate, create intents
     * 
     * SECURITY:
     * - Fetches Slack token at runtime from Parameter Store
     * - NO secrets in environment variables
     * - Only non-sensitive config in environment
     */
    const commandHandler = new lambda.Function(this, 'CommandHandler', {
      functionName: `slack-bot-${envName}-command-handler`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../runtime/handlers/command-handler')
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        // ✅ GOOD: Non-sensitive configuration only
        ENVIRONMENT: envName,
        INTENT_QUEUE_URL: intentQueue.queueUrl,
        LOG_LEVEL: 'info',
        
        // ❌ NEVER DO THIS:
        // SLACK_TOKEN: 'xoxb-...',              // Secret in environment
        // PARAM_PATH: '/slack-bot/token',       // Even paths are not allowed
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      description: 'Slack command handler - receives and validates commands'
    });

    // Grant Parameter Store access for runtime secret retrieval
    commandHandler.addToRolePolicy(parameterStorePolicy);

    // Grant SQS permissions to enqueue intents
    intentQueue.grantSendMessages(commandHandler);

    // ========================================================================
    // Lambda Handler 2: Processor (Python)
    // ========================================================================

    /**
     * RUNTIME: Python 3.12
     * PURPOSE: Process data, analyze, generate reports
     * 
     * WHY PYTHON?
     * - Excellent data processing libraries (Pandas, NumPy)
     * - AWS SDK (boto3) with rich API support
     * - Good for analytical workloads
     * 
     * SECURITY:
     * - Same pattern as Node.js handler
     * - Fetches secrets at runtime using boto3
     */
    const processorHandler = new lambda.Function(this, 'ProcessorHandler', {
      functionName: `slack-bot-${envName}-processor`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'main.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../runtime/handlers/processor')
      ),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        ENVIRONMENT: envName,
        LOG_LEVEL: 'INFO'
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      description: 'Data processor - analyzes and generates reports'
    });

    // Grant Parameter Store access
    processorHandler.addToRolePolicy(parameterStorePolicy);

    // ========================================================================
    // Lambda Handler 3: Executor (Go)
    // ========================================================================

    /**
     * RUNTIME: Go (custom runtime)
     * PURPOSE: Execute cloud operations via multi-cloud adapters
     * 
     * WHY GO?
     * - Fast startup time (important for Lambda)
     * - Low memory footprint
     * - Excellent concurrency for multi-cloud operations
     * - Strong typing and performance
     * 
     * SECURITY:
     * - Fetches cloud credentials at runtime
     * - Supports multiple cloud adapters (AWS, GCP, Azure)
     */
    const executorHandler = new lambda.Function(this, 'ExecutorHandler', {
      functionName: `slack-bot-${envName}-executor`,
      runtime: lambda.Runtime.PROVIDED_AL2023,  // Custom runtime for Go
      handler: 'bootstrap',  // Go Lambda expects 'bootstrap'
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../runtime/handlers/executor'),
        {
          // Go binaries are built before deployment
          // See runtime/handlers/executor/build.sh
        }
      ),
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      environment: {
        ENVIRONMENT: envName,
        LOG_LEVEL: 'info'
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      description: 'Cloud executor - runs operations via multi-cloud adapters'
    });

    // Grant Parameter Store access (includes GCP/Azure credentials)
    executorHandler.addToRolePolicy(parameterStorePolicy);

    // SQS event source: executor processes intents from queue
    executorHandler.addEventSource(new SqsEventSource(intentQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true
    }));

    // ========================================================================
    // API Gateway for Slack Commands
    // ========================================================================

    const api = new apigateway.RestApi(this, 'SlackBotAPI', {
      restApiName: `slack-bot-${envName}`,
      description: 'API for Slack slash commands',
      deployOptions: {
        stageName: envName,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true
      }
    });

    // /slack/command endpoint
    const slackResource = api.root.addResource('slack');
    const commandResource = slackResource.addResource('command');

    // POST /slack/command -> Command Handler (Node.js)
    commandResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(commandHandler, {
        proxy: true,
        allowTestInvoke: false
      })
    );

    // ========================================================================
    // CloudWatch Monitoring
    // ========================================================================

    // Lambda error alarms
    const createErrorAlarm = (func: lambda.Function, name: string) => {
      const alarm = new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
        alarmName: `slack-bot-${envName}-${name}-errors`,
        metric: func.metricErrors({
          statistic: 'Sum',
          period: cdk.Duration.minutes(5)
        }),
        threshold: 5,
        evaluationPeriods: 1,
        alarmDescription: `${name} Lambda error rate exceeded threshold`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
      });
      return alarm;
    };

    createErrorAlarm(commandHandler, 'CommandHandler');
    createErrorAlarm(processorHandler, 'ProcessorHandler');
    createErrorAlarm(executorHandler, 'ExecutorHandler');

    // SQS queue age alarm
    new cloudwatch.Alarm(this, 'QueueAgeAlarm', {
      alarmName: `slack-bot-${envName}-queue-age`,
      metric: intentQueue.metricApproximateAgeOfOldestMessage({
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5)
      }),
      threshold: 300, // 5 minutes
      evaluationPeriods: 1,
      alarmDescription: 'Intent queue messages aging beyond threshold'
    });

    // Parameter Store unauthorized access alarm (via CloudTrail metrics)
    const unauthorizedAccessMetric = new cloudwatch.Metric({
      namespace: 'AWS/SSM',
      metricName: 'UnauthorizedAccess',
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });

    new cloudwatch.Alarm(this, 'UnauthorizedParameterAccess', {
      alarmName: `slack-bot-${envName}-unauthorized-ssm-access`,
      metric: unauthorizedAccessMetric,
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Unauthorized Parameter Store access detected'
    });

    // ========================================================================
    // Outputs
    // ========================================================================

    new cdk.CfnOutput(this, 'APIEndpoint', {
      value: api.url,
      description: 'Slack command endpoint URL',
      exportName: `slack-bot-${envName}-api-endpoint`
    });

    new cdk.CfnOutput(this, 'IntentQueueURL', {
      value: intentQueue.queueUrl,
      description: 'Intent queue URL',
      exportName: `slack-bot-${envName}-intent-queue-url`
    });

    new cdk.CfnOutput(this, 'CommandHandlerArn', {
      value: commandHandler.functionArn,
      description: 'Command handler Lambda ARN',
      exportName: `slack-bot-${envName}-command-handler-arn`
    });

    new cdk.CfnOutput(this, 'ExecutorHandlerArn', {
      value: executorHandler.functionArn,
      description: 'Executor handler Lambda ARN',
      exportName: `slack-bot-${envName}-executor-handler-arn`
    });

    // ========================================================================
    // Tags
    // ========================================================================

    cdk.Tags.of(this).add('Application', 'slack-bot');
    cdk.Tags.of(this).add('Environment', envName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}
