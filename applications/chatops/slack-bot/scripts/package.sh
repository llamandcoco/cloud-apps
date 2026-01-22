#!/bin/bash
# Lambda packaging script - Creates deployment packages for each Lambda function
# Usage: ./package.sh [worker-name]
#   worker-name: Optional. If specified, only packages that worker (router, deploy, status, sr, lw)
#   If omitted, packages all workers
#
# Quadrant-based workers:
#   sr  - Short-Read unified worker (handles /echo, /check-status, etc.)
#   lw  - Long-Write unified worker (handles /build, /deploy, etc.)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build"
DIST_DIR="$PROJECT_ROOT/dist"

# Parse arguments
TARGET_WORKER="$1"

echo "🚀 Starting Lambda packaging process..."

# Create dist directory if it doesn't exist
mkdir -p "$DIST_DIR"

# Ensure build exists
if [ ! -d "$BUILD_DIR" ]; then
  echo "❌ Build directory not found. Run 'npm run build' first."
  exit 1
fi

# Function to package a Lambda
package_lambda() {
  local name=$1
  local source_path=$2

  echo "📦 Packaging $name..."

  local temp_dir="$DIST_DIR/temp-$name"
  mkdir -p "$temp_dir"

  # Copy compiled code - maintain directory structure for relative imports
  # Extract the relative path from BUILD_DIR (e.g., "workers/echo")
  local rel_path="${source_path#$BUILD_DIR/}"
  mkdir -p "$temp_dir/$rel_path"
  cp -r "$source_path"/* "$temp_dir/$rel_path/"

  # Copy shared utilities at the correct relative level
  if [ -d "$BUILD_DIR/shared" ]; then
    mkdir -p "$temp_dir/shared"
    cp -r "$BUILD_DIR/shared"/* "$temp_dir/shared/"
  fi

  # For quadrant workers (sr, lw, lr, sw), also copy handlers
  if [[ "$name" == "sr-worker" || "$name" == "lw-worker" || "$name" == "lr-worker" || "$name" == "sw-worker" ]]; then
    if [ -d "$BUILD_DIR/workers/handlers" ]; then
      mkdir -p "$temp_dir/workers/handlers"
      cp -r "$BUILD_DIR/workers/handlers"/* "$temp_dir/workers/handlers/"
      echo "   📁 Including handlers for unified worker"
    fi
  fi

  # Copy package files
  cp "$PROJECT_ROOT/package.json" "$temp_dir/"
  cp "$PROJECT_ROOT/package-lock.json" "$temp_dir/"

  # Install production dependencies
  echo "   Installing dependencies..."
  cd "$temp_dir"
  npm ci --production --silent

  # Create zip
  echo "   Creating zip archive..."
  zip -qr "$DIST_DIR/$name.zip" .

  # Cleanup temp directory
  cd "$PROJECT_ROOT"
  rm -rf "$temp_dir"

  local size=$(du -h "$DIST_DIR/$name.zip" | cut -f1)
  echo "   ✅ $name.zip created ($size)"
}

# Package based on target
if [ -n "$TARGET_WORKER" ]; then
  # Package specific worker
  case "$TARGET_WORKER" in
    router)
      package_lambda "router" "$BUILD_DIR/router"
      ;;
    # Quadrant-based workers (NEW)
    sr)
      package_lambda "sr-worker" "$BUILD_DIR/workers/sr"
      ;;
    lw)
      package_lambda "lw-worker" "$BUILD_DIR/workers/lw"
      ;;
    lr)
      package_lambda "lr-worker" "$BUILD_DIR/workers/lr"
      ;;
    sw)
      package_lambda "sw-worker" "$BUILD_DIR/workers/sw"
      ;;
    deploy)
      package_lambda "deploy-worker" "$BUILD_DIR/workers/deploy"
      ;;
    status)
      package_lambda "status-worker" "$BUILD_DIR/workers/status"
      ;;
    *)
      echo "❌ Unknown worker: $TARGET_WORKER"
      echo "Valid options:"
        echo "  Quadrant-based: sr, lw, lr, sw"
        echo "  Legacy: router, deploy, status"
      exit 1
      ;;
  esac
else
  # Package all workers (quadrant-based + router)
  echo "📦 Packaging quadrant-based workers..."
  package_lambda "router" "$BUILD_DIR/router"
  package_lambda "sr-worker" "$BUILD_DIR/workers/sr"
  package_lambda "lw-worker" "$BUILD_DIR/workers/lw"

  echo ""
  echo "ℹ️  Legacy command-based workers not packaged by default."
  echo "   Use ./package.sh [worker-name] to package specific legacy workers."
fi

echo ""
echo "✨ Packaging complete!"
echo "📦 Packages created in: $DIST_DIR"
ls -lh "$DIST_DIR"/*.zip 2>/dev/null || echo "  (use ./package.sh [worker-name] to package specific worker)"
