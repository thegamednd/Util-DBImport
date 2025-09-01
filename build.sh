#!/bin/bash

# Build script for Util-DBImport Lambda

echo "Building Util-DBImport Lambda..."

# Clean previous build
rm -rf dist
mkdir -p dist

# Copy source files (already .mjs)
cp -r src/* dist/

# Create production-only package.json for dist
cat > dist/package.json << 'EOF'
{
  "name": "util-dbimport",
  "version": "1.0.0",
  "type": "module",
  "main": "handler.mjs",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.637.0",
    "@aws-sdk/client-s3": "^3.637.0",
    "@aws-sdk/util-dynamodb": "^3.637.0"
  }
}
EOF

# Install only production dependencies in dist
cd dist && npm install --production --silent --no-package-lock && cd ..

# Clean up unnecessary files
cd dist && find node_modules -name "*.md" -delete 2>/dev/null || true && find node_modules -name "*.txt" -delete 2>/dev/null || true && cd ..

echo "Build completed. Deployment package ready in dist/"

# Verify the build
echo "Build verification:"
echo "- Handler file: $([ -f dist/handler.mjs ] && echo "✓ Found" || echo "✗ Missing")"
echo "- Dependencies: $([ -d dist/node_modules ] && echo "✓ Found" || echo "✗ Missing")"
echo "- Package.json: $([ -f dist/package.json ] && echo "✓ Found" || echo "✗ Missing")"