#!/bin/bash

# LocalStack initialization script
# Creates SQS queues, EventBridge bus, and SSM parameters

set -e

echo "Setting up LocalStack resources..."

# Create SQS queues (quadrant-based)
awslocal sqs create-queue --queue-name laco-local-sr-queue
awslocal sqs create-queue --queue-name laco-local-sr-queue-dlq
awslocal sqs create-queue --queue-name laco-local-lw-queue
awslocal sqs create-queue --queue-name laco-local-lw-queue-dlq

# Create EventBridge bus
awslocal events create-event-bus --name laco-local-chatbot

# Queue ARNs (LocalStack account id 000000000000)
SR_QUEUE_ARN="arn:aws:sqs:ca-central-1:000000000000:laco-local-sr-queue"
LW_QUEUE_ARN="arn:aws:sqs:ca-central-1:000000000000:laco-local-lw-queue"

# Create EventBridge rules
awslocal events put-rule \
  --name laco-local-chatbot-echo \
  --event-bus-name laco-local-chatbot \
  --event-pattern '{"source":["slack.command"],"detail-type":["Slack Command"],"detail":{"command":["/echo"]}}'

awslocal events put-targets \
  --event-bus-name laco-local-chatbot \
  --rule laco-local-chatbot-echo \
  --targets "[{\"Id\":\"sr-sqs\",\"Arn\":\"${SR_QUEUE_ARN}\",\"InputPath\":\"$.detail\"}]"

awslocal events put-rule \
  --name laco-local-chatbot-build \
  --event-bus-name laco-local-chatbot \
  --event-pattern '{"source":["slack.command"],"detail-type":["Slack Command"],"detail":{"command":["/build"]}}'

awslocal events put-targets \
  --event-bus-name laco-local-chatbot \
  --rule laco-local-chatbot-build \
  --targets "[{\"Id\":\"lw-sqs\",\"Arn\":\"${LW_QUEUE_ARN}\",\"InputPath\":\"$.detail\"}]"

awslocal events put-rule \
  --name laco-local-chatbot-catch-all \
  --event-bus-name laco-local-chatbot \
  --event-pattern '{"source":["slack.command"],"detail-type":["Slack Command"],"detail":{"command":[{"anything-but":["/echo","/build"]}]}}'

awslocal events put-targets \
  --event-bus-name laco-local-chatbot \
  --rule laco-local-chatbot-catch-all \
  --targets "[{\"Id\":\"sr-sqs\",\"Arn\":\"${SR_QUEUE_ARN}\",\"InputPath\":\"$.detail\"}]"

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
