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

# Load component configuration
source "$SCRIPT_DIR/component-config.sh"

if [ -z "$COMPONENT" ]; then
  echo -e "${YELLOW}Error: Component name required${NC}"
  echo "Usage: $0 <component-name> [--local]"
  echo "Valid components: $VALID_COMPONENTS"
  exit 1
fi

# Validate and get component info
if ! validate_component "$COMPONENT"; then
  show_component_error "$COMPONENT"
  exit 1
fi

TG_PATH=$(get_tg_path "$COMPONENT")

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
