#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SlackBotStack } from '../lib/slack-bot-stack';

const app = new cdk.App();

// Get environment from context (default: staging)
const environment = app.node.tryGetContext('environment') || 'staging';

if (environment !== 'staging' && environment !== 'production') {
  throw new Error('Environment must be either "staging" or "production"');
}

new SlackBotStack(app, `SlackBotStack-${environment}`, {
  environment: environment as 'staging' | 'production',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
  description: `Slack Bot application infrastructure (${environment})`,
  tags: {
    Application: 'slack-bot',
    Environment: environment,
    ManagedBy: 'CDK'
  }
});

app.synth();
