#!/bin/bash
set -e

echo "Building Go Lambda function..."

# Build for Lambda (Linux AMD64)
GOOS=linux GOARCH=amd64 go build -o bootstrap main.go

echo "Build complete: bootstrap"
echo "File size: $(du -h bootstrap | cut -f1)"

# Verify the binary
file bootstrap
