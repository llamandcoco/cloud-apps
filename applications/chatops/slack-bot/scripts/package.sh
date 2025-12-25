#!/bin/bash
# Lambda packaging script - Creates deployment packages for each Lambda function

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build"
DIST_DIR="$PROJECT_ROOT/dist"

echo "🚀 Starting Lambda packaging process..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf "$DIST_DIR"
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

# Package each Lambda
package_lambda "router" "$BUILD_DIR/router"
package_lambda "echo-worker" "$BUILD_DIR/workers/echo"
package_lambda "deploy-worker" "$BUILD_DIR/workers/deploy"
package_lambda "status-worker" "$BUILD_DIR/workers/status"

echo ""
echo "✨ Packaging complete!"
echo "📦 Packages created in: $DIST_DIR"
ls -lh "$DIST_DIR"/*.zip
