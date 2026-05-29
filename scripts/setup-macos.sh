#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Installing dependencies..."
npm install

echo
echo "Setup complete."
echo "Start the remote bridge with: npm run mobile"
echo "For local-only testing: npm run mobile:local"
