#!/bin/bash
# Deploy from S3 with smart version handling
# Usage: ./deploy-from-s3.sh <component> <environment> [version]

set -e

COMPONENT="$1"
ENVIRONMENT="$2"
# Use environment variable VERSION if set, otherwise use argument $3
VERSION="${VERSION:-$3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SANDBOX_ROOT="${SANDBOX_ROOT:-$PROJECT_ROOT/../../../../cloud-sandbox/aws/10-plt}"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load component configuration
source "$SCRIPT_DIR/component-config.sh"

# S3 Configuration
S3_BUCKET="laco-${ENVIRONMENT}-lambda-artifacts"
S3_PREFIX="${ENVIRONMENT}/${COMPONENT}/builds"

if [ -z "$COMPONENT" ] || [ -z "$ENVIRONMENT" ]; then
  echo -e "${YELLOW}Error: Component and environment required${NC}"
  echo "Usage: $0 <component> <environment> [version]"
  echo "Valid components: $VALID_COMPONENTS"
  exit 1
fi

# Validate and get component info
if ! validate_component "$COMPONENT"; then
  show_component_error "$COMPONENT"
  exit 1
fi

TG_PATH=$(get_tg_path "$COMPONENT")

echo -e "${BLUE}Deploying $COMPONENT from S3 (environment: $ENVIRONMENT)...${NC}"

# Function to list available versions in S3
list_s3_versions() {
  local region="${AWS_REGION:-ca-central-1}"
  local profile_arg=""

  if [ -n "$AWS_PROFILE" ]; then
    profile_arg="--profile $AWS_PROFILE"
  fi

  # Debug output
  if [ "${DEBUG:-0}" = "1" ]; then
    echo "[DEBUG] S3_BUCKET=$S3_BUCKET" >&2
    echo "[DEBUG] S3_PREFIX=$S3_PREFIX" >&2
    echo "[DEBUG] AWS_PROFILE=$AWS_PROFILE" >&2
    echo "[DEBUG] AWS_REGION=$region" >&2
  fi

  # List objects and extract version numbers
  aws s3api list-objects-v2 \
    --bucket "$S3_BUCKET" \
    --prefix "$S3_PREFIX/" \
    --region "$region" \
    $profile_arg \
    --query 'Contents[?ends_with(Key, `.zip`)].Key' \
    --output text 2>/dev/null | \
    tr '\t' '\n' | \
    grep '\.zip$' | \
    sed 's|.*/||; s|\.zip$||' | \
    sort -r || true
}

# Function to check if version exists in S3
version_exists_in_s3() {
  local version="$1"
  local region="${AWS_REGION:-ca-central-1}"
  local profile_arg=""

  if [ -n "$AWS_PROFILE" ]; then
    profile_arg="--profile $AWS_PROFILE"
  fi

  aws s3api head-object \
    --bucket "$S3_BUCKET" \
    --key "$S3_PREFIX/${version}.zip" \
    --region "$region" \
    $profile_arg \
    >/dev/null 2>&1
}

# Determine which version to use
if [ -n "$VERSION" ]; then
  # Version specified, check if it exists
  echo -e "${BLUE}Checking for version: $VERSION${NC}"
  if version_exists_in_s3 "$VERSION"; then
    echo -e "${GREEN}✓ Version $VERSION found in S3${NC}"
    DEPLOY_VERSION="$VERSION"
  else
    echo -e "${YELLOW}⚠ Version $VERSION not found in S3${NC}"
    read -p "Build and upload this version? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      echo -e "${BLUE}Building and uploading version $VERSION...${NC}"
      cd "$PROJECT_ROOT"
      make "build-$COMPONENT"
      AWS_REGION="${AWS_REGION:-ca-central-1}" \
        "$SCRIPT_DIR/upload-lambda.sh" "$COMPONENT" "$ENVIRONMENT" "$VERSION"
      DEPLOY_VERSION="$VERSION"
    else
      echo -e "${YELLOW}Deployment cancelled${NC}"
      exit 1
    fi
  fi
else
  # No version specified, list available versions
  echo -e "${BLUE}Fetching available versions from S3...${NC}"
  VERSIONS=$(list_s3_versions)

  if [ -z "$VERSIONS" ]; then
    echo -e "${YELLOW}⚠ No versions found in S3${NC}"
    # Use git commit hash as default version
    DEFAULT_VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo "local")
    echo -e "${BLUE}Using git commit hash: $DEFAULT_VERSION${NC}"
    read -p "Build and upload this version? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      cd "$PROJECT_ROOT"
      make "build-$COMPONENT"
      AWS_REGION="${AWS_REGION:-ca-central-1}" \
        "$SCRIPT_DIR/upload-lambda.sh" "$COMPONENT" "$ENVIRONMENT" "$DEFAULT_VERSION"
      DEPLOY_VERSION="$DEFAULT_VERSION"
    else
      echo -e "${YELLOW}Deployment cancelled${NC}"
      exit 1
    fi
  else
    # Show available versions with latest marker
    echo -e "${GREEN}Available versions in S3:${NC}"
    LATEST=$(echo "$VERSIONS" | head -1)
    echo "$VERSIONS" | awk -v latest="$LATEST" '{
      if (NR == 1) {
        printf "%2d. %s (latest)\n", NR, $0
      } else {
        printf "%2d. %s\n", NR, $0
      }
    }'
    echo ""
    echo "Select a version:"
    echo "  - Enter number to select"
    echo "  - Press Enter for latest ($LATEST)"
    echo "  - Type 'new' to build and upload current version"
    echo ""
    read -p "Choice: " CHOICE

    if [ -z "$CHOICE" ]; then
      # Use latest version
      DEPLOY_VERSION=$(echo "$VERSIONS" | head -1)
      echo -e "${GREEN}Using latest version: $DEPLOY_VERSION${NC}"
    elif [ "$CHOICE" = "new" ]; then
      # Build new version
      DEFAULT_VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo "local")
      echo -e "${BLUE}Building new version: $DEFAULT_VERSION${NC}"
      cd "$PROJECT_ROOT"
      make "build-$COMPONENT"
      AWS_REGION="${AWS_REGION:-ca-central-1}" \
        "$SCRIPT_DIR/upload-lambda.sh" "$COMPONENT" "$ENVIRONMENT" "$DEFAULT_VERSION"
      DEPLOY_VERSION="$DEFAULT_VERSION"
    elif [[ "$CHOICE" =~ ^[0-9]+$ ]]; then
      # Select by number
      DEPLOY_VERSION=$(echo "$VERSIONS" | sed -n "${CHOICE}p")
      if [ -z "$DEPLOY_VERSION" ]; then
        echo -e "${YELLOW}Error: Invalid selection${NC}"
        exit 1
      fi
      echo -e "${GREEN}Using selected version: $DEPLOY_VERSION${NC}"
    else
      echo -e "${YELLOW}Error: Invalid input${NC}"
      exit 1
    fi
  fi
fi

# Deploy using the selected version
echo -e "${BLUE}Deploying $COMPONENT version $DEPLOY_VERSION...${NC}"
cd "$SANDBOX_ROOT/$TG_PATH"
USE_S3_ARTIFACTS=true LAMBDA_VERSION="$DEPLOY_VERSION" terragrunt apply

echo -e "${GREEN}✓ $COMPONENT deployed successfully from S3 (version: $DEPLOY_VERSION)${NC}"
