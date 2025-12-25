#!/bin/bash
# -----------------------------------------------------------------------------
# Upload Lambda Artifact to S3
# Usage:
#   ./scripts/upload-lambda.sh <function> [environment] [version]
#
# Examples:
#   ./scripts/upload-lambda.sh echo
#   ./scripts/upload-lambda.sh echo plt abc123
#   ./scripts/upload-lambda.sh echo prod v1.0.0
# -----------------------------------------------------------------------------

set -e

# Parse arguments
FUNCTION=$1
ENVIRONMENT=${2:-plt}
VERSION=${3:-$(git rev-parse --short HEAD 2>/dev/null || echo "local")}

# Validation
if [ -z "$FUNCTION" ]; then
  echo "Error: Function name required"
  echo "Usage: $0 <function> [environment] [version]"
  echo "Functions: echo, deploy, status, router"
  exit 1
fi

# Configuration
BUCKET="laco-${ENVIRONMENT}-lambda-artifacts"
BUILD_DIR="dist"
ZIP_FILE="${FUNCTION}-worker.zip"
S3_PREFIX="${ENVIRONMENT}/${FUNCTION}/builds"
REGION="${AWS_REGION:-ca-central-1}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=== Uploading Lambda Artifact ===${NC}"
echo "Function:    ${FUNCTION}"
echo "Environment: ${ENVIRONMENT}"
echo "Version:     ${VERSION}"
echo "Bucket:      s3://${BUCKET}"
echo ""

# Check if ZIP exists
if [ ! -f "${BUILD_DIR}/${ZIP_FILE}" ]; then
  echo -e "${YELLOW}Error: ${BUILD_DIR}/${ZIP_FILE} not found${NC}"
  echo "Run 'npm run build' first"
  exit 1
fi

# Get file info
FILE_SIZE=$(stat -f%z "${BUILD_DIR}/${ZIP_FILE}" 2>/dev/null || stat -c%s "${BUILD_DIR}/${ZIP_FILE}")
FILE_HASH=$(shasum -a 256 "${BUILD_DIR}/${ZIP_FILE}" | cut -d' ' -f1)

echo "[1/4] File Information"
echo "  Size: $(numfmt --to=iec-i --suffix=B $FILE_SIZE 2>/dev/null || echo $FILE_SIZE bytes)"
echo "  SHA256: ${FILE_HASH:0:16}..."
echo ""

# Create metadata
echo "[2/4] Creating metadata..."
METADATA=$(cat <<EOF
{
  "function": "${FUNCTION}",
  "version": "${VERSION}",
  "git": {
    "commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
    "short_commit": "${VERSION}",
    "branch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')",
    "tag": "$(git describe --tags --exact-match 2>/dev/null || echo 'none')",
    "author": "$(git log -1 --format='%an <%ae>' 2>/dev/null || echo 'unknown')",
    "message": "$(git log -1 --format='%s' 2>/dev/null || echo 'no message')"
  },
  "build": {
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "builder": "${USER}@$(hostname)",
    "ci": "${CI:-false}",
    "node_version": "$(node --version 2>/dev/null || echo 'unknown')",
    "npm_version": "$(npm --version 2>/dev/null || echo 'unknown')"
  },
  "artifact": {
    "size_bytes": ${FILE_SIZE},
    "checksum_sha256": "${FILE_HASH}",
    "filename": "${ZIP_FILE}"
  },
  "environment": "${ENVIRONMENT}",
  "region": "${REGION}"
}
EOF
)

echo -e "${GREEN}✓ Metadata created${NC}"
echo ""

# Upload to S3
echo "[3/4] Uploading to S3..."

# Upload ZIP file
aws s3 cp "${BUILD_DIR}/${ZIP_FILE}" \
  "s3://${BUCKET}/${S3_PREFIX}/${VERSION}.zip" \
  --region "${REGION}" \
  --metadata "git-commit=${VERSION},build-time=$(date -u +%Y-%m-%dT%H:%M:%SZ),checksum=${FILE_HASH}"

# Upload metadata JSON
echo "$METADATA" | aws s3 cp - \
  "s3://${BUCKET}/${S3_PREFIX}/${VERSION}.json" \
  --region "${REGION}" \
  --content-type application/json

echo -e "${GREEN}✓ Uploaded versioned artifact${NC}"
echo "  s3://${BUCKET}/${S3_PREFIX}/${VERSION}.zip"
echo "  s3://${BUCKET}/${S3_PREFIX}/${VERSION}.json"
echo ""

# Update 'latest' pointers
echo "[4/4] Updating 'latest' pointers..."

aws s3 cp "s3://${BUCKET}/${S3_PREFIX}/${VERSION}.zip" \
  "s3://${BUCKET}/${ENVIRONMENT}/${FUNCTION}/latest.zip" \
  --region "${REGION}"

aws s3 cp "s3://${BUCKET}/${S3_PREFIX}/${VERSION}.json" \
  "s3://${BUCKET}/${ENVIRONMENT}/${FUNCTION}/latest.json" \
  --region "${REGION}"

echo -e "${GREEN}✓ Updated latest pointers${NC}"
echo "  s3://${BUCKET}/${ENVIRONMENT}/${FUNCTION}/latest.zip"
echo "  s3://${BUCKET}/${ENVIRONMENT}/${FUNCTION}/latest.json"
echo ""

# Update manifest (list of all versions)
MANIFEST_FILE=$(mktemp)
trap "rm -f $MANIFEST_FILE" EXIT

cat > "$MANIFEST_FILE" <<EOF
{
  "function": "${FUNCTION}",
  "environment": "${ENVIRONMENT}",
  "latest_version": "${VERSION}",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "versions": [
EOF

# List all versions
aws s3 ls "s3://${BUCKET}/${S3_PREFIX}/" --region "${REGION}" | \
  grep -E '\.zip$' | \
  awk '{print $4}' | \
  sed 's/.zip$//' | \
  awk '{printf "    \"%s\"%s\n", $0, (NR==1?"":",")}'  >> "$MANIFEST_FILE"

cat >> "$MANIFEST_FILE" <<EOF
  ]
}
EOF

aws s3 cp "$MANIFEST_FILE" \
  "s3://${BUCKET}/${ENVIRONMENT}/${FUNCTION}/manifest.json" \
  --region "${REGION}" \
  --content-type application/json

echo -e "${GREEN}✓ Updated manifest${NC}"
echo ""

# Get S3 object version ID
echo "Getting S3 object version ID..."
VERSION_ID=$(aws s3api head-object \
  --bucket "${BUCKET}" \
  --key "${ENVIRONMENT}/${FUNCTION}/builds/${VERSION}.zip" \
  --region "${REGION}" \
  --query 'VersionId' \
  --output text 2>/dev/null || echo "null")

echo -e "${GREEN}=== Upload Complete ===${NC}"
echo ""
echo "S3 Object Version ID: ${VERSION_ID}"
echo ""
echo "Deployment command:"
echo "  cd cloud-sandbox/aws/10-plt/chatbot-${FUNCTION}-worker"
echo "  USE_S3_ARTIFACTS=true LAMBDA_VERSION=${VERSION} S3_OBJECT_VERSION=${VERSION_ID} terragrunt apply"
echo ""

# Export for Makefile to capture
echo "##VERSION_ID=${VERSION_ID}##"
