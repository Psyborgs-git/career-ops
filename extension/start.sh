#!/bin/bash
# Start Career-Ops Extension Daemon + Build Extension

set -e

EXTENSION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Career-Ops Extension Launcher"
echo ""

# Check if daemon is running
echo "📡 Checking daemon..."
if curl -s http://localhost:3737/health > /dev/null 2>&1; then
  echo "✅ Daemon already running on localhost:3737"
else
  echo "🔧 Starting daemon (localhost:3737)..."
  echo "   Run this in a separate terminal:"
  echo "   cd $EXTENSION_DIR && npm run daemon"
  echo ""
  echo "   Waiting for daemon..."
  sleep 2
  
  if ! curl -s http://localhost:3737/health > /dev/null 2>&1; then
    echo "❌ Daemon not running. Start it with: npm run daemon"
    exit 1
  fi
  echo "✅ Daemon started"
fi

echo ""
echo "🔨 Building extension..."
cd "$EXTENSION_DIR"
npm run build

echo ""
echo "✅ Extension built successfully!"
echo ""
echo "📦 Next steps:"
echo "   1. Open chrome://extensions/"
echo "   2. Enable 'Developer mode' (top right)"
echo "   3. Click 'Load unpacked'"
echo "   4. Select: $EXTENSION_DIR/dist"
echo ""
echo "💡 Keep daemon running: npm run daemon"
