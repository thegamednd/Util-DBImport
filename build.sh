#!/bin/bash

# Build script for Util-DBImport Lambda

echo "Building Util-DBImport Lambda..."

# Clean previous build
rm -rf dist
mkdir -p dist

# Copy source files
cp -r src/* dist/

# Copy package files
cp package.json dist/
cp package-lock.json dist/ 2>/dev/null || true

# Install production dependencies in dist
cd dist
npm ci --omit=dev || npm install --production

# Create a simple deployment directory (AWS Lambda can work with directory structure too)
echo "Build completed. Source files and dependencies ready in dist/"
echo "Note: For actual deployment, you'll need to create a zip file from the dist/ contents"

cd ..

# Verify the build
echo "Build verification:"
echo "- Source file: $([ -f dist/handler.js ] && echo "✓ Found" || echo "✗ Missing")"
echo "- Dependencies: $([ -d dist/node_modules ] && echo "✓ Found" || echo "✗ Missing")"
echo "- Package.json: $([ -f dist/package.json ] && echo "✓ Found" || echo "✗ Missing")"