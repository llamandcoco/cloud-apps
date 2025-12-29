#!/bin/bash
# Build component script - Common logic for building Lambda components
# Usage: ./build-component.sh <component-name>

set -e

COMPONENT="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$COMPONENT" ]; then
  echo -e "${YELLOW}Error: Component name required${NC}"
  echo "Usage: $0 <component-name>"
  echo "Valid components: router, echo, deploy, status, build"
  exit 1
fi

# Component to zip filename mapping
case "$COMPONENT" in
  router)
    ZIP_NAME="router"
    ;;
  echo)
    ZIP_NAME="echo-worker"
    ;;
  deploy)
    ZIP_NAME="deploy-worker"
    ;;
  status)
    ZIP_NAME="status-worker"
    ;;
  build)
    ZIP_NAME="build-worker"
    ;;
  *)
    echo -e "${YELLOW}Error: Unknown component: $COMPONENT${NC}"
    echo "Valid components: router, echo, deploy, status, build"
    exit 1
    ;;
esac

echo -e "${BLUE}Building $COMPONENT...${NC}"

# Run TypeScript compilation
npm run build

# Package the component
"$SCRIPT_DIR/package.sh" "$COMPONENT"

# Verify zip file was created
ZIP_FILE="$DIST_DIR/${ZIP_NAME}.zip"
if [ ! -f "$ZIP_FILE" ]; then
  echo -e "${YELLOW}Error: ${ZIP_NAME}.zip not created${NC}"
  exit 1
fi

echo -e "${GREEN}✓ $COMPONENT built: dist/${ZIP_NAME}.zip${NC}"
