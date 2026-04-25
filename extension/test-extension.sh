#!/bin/bash

# Career-Ops Extension - Comprehensive Test Suite
# Tests all components end-to-end

set -e

EXTENSION_DIR="/Users/jainamshah/Documents/GitHub/career-ops/extension"
DAEMON_PORT=3737

echo "======================================"
echo "Career-Ops Extension - Test Suite"
echo "======================================"
echo ""

# Test 1: Daemon health
echo "✓ TEST 1: Daemon health check"
HEALTH=$(curl -s http://localhost:${DAEMON_PORT}/health)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "  ✓ Daemon responding"
else
  echo "  ✗ Daemon not responding"
  exit 1
fi
echo ""

# Test 2: Postings endpoint
echo "✓ TEST 2: Postings endpoint"
POSTINGS=$(curl -s http://localhost:${DAEMON_PORT}/api/postings)
COUNT=$(echo "$POSTINGS" | grep -o '"number"' | wc -l)
echo "  ✓ Loaded $COUNT postings"
if echo "$POSTINGS" | grep -q '"url":"http'; then
  echo "  ✓ Posting URLs hydrated from reports"
else
  echo "  ✗ Posting URLs missing"
  exit 1
fi
echo ""

# Test 3: Sync endpoint (full data)
echo "✓ TEST 3: Sync endpoint (full data)"
SYNC=$(curl -s http://localhost:${DAEMON_PORT}/api/sync)
if echo "$SYNC" | grep -q '"postings"' && echo "$SYNC" | grep -q '"reports"'; then
  echo "  ✓ Sync endpoint returns postings and reports"
else
  echo "  ✗ Sync endpoint format invalid"
  exit 1
fi
echo ""

# Test 4: CV endpoint
echo "✓ TEST 4: CV endpoint"
CV=$(curl -s http://localhost:${DAEMON_PORT}/api/cv)
if echo "$CV" | grep -q '"content"'; then
  echo "  ✓ CV data loaded"
else
  echo "  ✗ CV endpoint failed"
  exit 1
fi
echo ""

# Test 5: Profile endpoint
echo "✓ TEST 5: Profile endpoint"
PROFILE=$(curl -s http://localhost:${DAEMON_PORT}/api/profile)
if echo "$PROFILE" | grep -q '"content"'; then
  echo "  ✓ Profile data loaded"
else
  echo "  ✗ Profile endpoint failed"
  exit 1
fi
echo ""

# Test 6: Extension files exist
echo "✓ TEST 6: Extension files"
FILES=(
  "dist/background.js"
  "dist/content.js"
  "dist/sidebar.js"
  "dist/sidebar.html"
  "dist/manifest.json"
)
for file in "${FILES[@]}"; do
  if [ -f "$EXTENSION_DIR/$file" ]; then
    SIZE=$(du -h "$EXTENSION_DIR/$file" | cut -f1)
    echo "  ✓ $file ($SIZE)"
  else
    echo "  ✗ $file MISSING"
    exit 1
  fi
done
echo ""

# Test 7: Manifest validity
echo "✓ TEST 7: Manifest validity"
if cat "$EXTENSION_DIR/dist/manifest.json" | grep -q '"manifest_version": 3'; then
  echo "  ✓ Manifest v3 format correct"
else
  echo "  ✗ Manifest format invalid"
  exit 1
fi

if cat "$EXTENSION_DIR/dist/manifest.json" | grep -q '"service_worker": "background.js"'; then
  echo "  ✓ Service worker path correct"
else
  echo "  ✗ Service worker path incorrect"
  exit 1
fi
echo ""

echo "======================================"
echo "✓ ALL TESTS PASSED"
echo "======================================"
echo ""
echo "Extension is ready to load in Chrome:"
echo "1. Go to: chrome://extensions/"
echo "2. Enable 'Developer mode' (top right)"
echo "3. Click 'Load unpacked'"
echo "4. Select: $EXTENSION_DIR/dist"
echo ""
echo "Daemon is running on: http://localhost:$DAEMON_PORT"
echo ""
