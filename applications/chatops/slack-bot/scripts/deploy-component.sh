#!/bin/bash
# Deploy component script - Common logic for deploying Lambda components
# Usage: ./deploy-component.sh <component-name> [--local]

set -e

COMPONENT="$1"
DEPLOY_MODE="${2:-s3}"  # s3 or --local
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SANDBOX_ROOT="${SANDBOX_ROOT:-$PROJECT_ROOT/../../../../cloud-sandbox/aws/10-plt}"
VERSION="${VERSION:-$(git rev-parse --short HEAD 2>/dev/null || echo "local")}"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$COMPONENT" ]; then
  echo -e "${YELLOW}Error: Component name required${NC}"
  echo "Usage: $0 <component-name> [--local]"
  echo "Valid components: router, echo, deploy, status, build"
  exit 1
fi

# Component to Terragrunt directory mapping
case "$COMPONENT" in
  router)
    TG_PATH="slack-router-lambda"
    ;;
  echo)
    TG_PATH="chatbot-echo-worker"
    ;;
  deploy)
    TG_PATH="chatbot-deploy-worker"
    ;;
  status)
    TG_PATH="chatbot-status-worker"
    ;;
  build)
    TG_PATH="chatbot-build-worker"
    ;;
  *)
    echo -e "${YELLOW}Error: Unknown component: $COMPONENT${NC}"
    echo "Valid components: router, echo, deploy, status, build"
    exit 1
    ;;
esac

# Determine deploy mode
if [ "$DEPLOY_MODE" = "--local" ]; then
  echo -e "${BLUE}Deploying $COMPONENT from local build...${NC}"
  cd "$SANDBOX_ROOT/$TG_PATH"
  terragrunt apply
  echo -e "${GREEN}✓ $COMPONENT deployed from local${NC}"
else
  echo -e "${BLUE}Deploying $COMPONENT from S3 (version: $VERSION)...${NC}"

  # Check for S3 version ID
  S3_VERSION_FILE="$PROJECT_ROOT/.s3-version-id-$COMPONENT.tmp"
  if [ -f "$S3_VERSION_FILE" ]; then
    S3_VERSION_ID=$(cat "$S3_VERSION_FILE")
    echo "Using S3 version ID: $S3_VERSION_ID"
    cd "$SANDBOX_ROOT/$TG_PATH"
    USE_S3_ARTIFACTS=true LAMBDA_VERSION="$VERSION" S3_OBJECT_VERSION="$S3_VERSION_ID" terragrunt apply
  else
    cd "$SANDBOX_ROOT/$TG_PATH"
    USE_S3_ARTIFACTS=true LAMBDA_VERSION="$VERSION" terragrunt apply
  fi

  echo -e "${GREEN}✓ $COMPONENT deployed from S3${NC}"
fi
