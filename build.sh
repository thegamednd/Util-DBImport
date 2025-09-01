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

# Create deployment package
zip -r lambda-package.zip . -x "*.git*" -x "*.DS_Store" > /dev/null

# Move package to dist root and clean up
mv lambda-package.zip ../
cd ..
mv lambda-package.zip dist/

echo "Build completed. Deployment package ready in dist/"