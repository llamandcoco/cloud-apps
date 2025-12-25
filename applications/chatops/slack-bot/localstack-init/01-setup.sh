#!/bin/bash

# LocalStack initialization script
# Creates SQS queues, EventBridge bus, and SSM parameters

set -e

echo "Setting up LocalStack resources..."

# Create SQS queues
awslocal sqs create-queue --queue-name laco-local-chatbot-echo
awslocal sqs create-queue --queue-name laco-local-chatbot-echo-dlq
awslocal sqs create-queue --queue-name laco-local-chatbot-deploy
awslocal sqs create-queue --queue-name laco-local-chatbot-deploy-dlq
awslocal sqs create-queue --queue-name laco-local-chatbot-status
awslocal sqs create-queue --queue-name laco-local-chatbot-status-dlq

# Create EventBridge bus
awslocal events create-event-bus --name laco-local-chatbot

# Create EventBridge rules
awslocal events put-rule \
  --name laco-local-chatbot-echo \
  --event-bus-name laco-local-chatbot \
  --event-pattern '{"source":["slack.command"],"detail-type":["Slack Command"],"detail":{"command":["/echo"]}}'

awslocal events put-rule \
  --name laco-local-chatbot-deploy \
  --event-bus-name laco-local-chatbot \
  --event-pattern '{"source":["slack.command"],"detail-type":["Slack Command"],"detail":{"command":["/deploy"]}}'

awslocal events put-rule \
  --name laco-local-chatbot-status \
  --event-bus-name laco-local-chatbot \
  --event-pattern '{"source":["slack.command"],"detail-type":["Slack Command"],"detail":{"command":["/status"]}}'

# Create SSM parameters for secrets
awslocal ssm put-parameter \
  --name /laco/local/aws/secrets/slack/bot-token \
  --value "xoxb-local-test-token" \
  --type SecureString

awslocal ssm put-parameter \
  --name /laco/local/aws/secrets/slack/signing-secret \
  --value "local-test-secret" \
  --type SecureString

echo "LocalStack setup complete!"
