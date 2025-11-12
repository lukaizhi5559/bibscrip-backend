#!/bin/bash

# Simple one-command test for Nut.js API
# Usage: 
#   bash test-nutjs-simple.sh "your command here"
#   THINKDROP_API_KEY=your-key bash test-nutjs-simple.sh "your command"

# Check if API key is set
if [ -z "$THINKDROP_API_KEY" ]; then
  echo "❌ Error: THINKDROP_API_KEY environment variable not set"
  echo ""
  echo "Usage:"
  echo "  THINKDROP_API_KEY=your-key bash test-nutjs-simple.sh \"your command\""
  echo ""
  echo "Or add to your .env file:"
  echo "  THINKDROP_API_KEY=your-key"
  exit 1
fi

API_KEY="$THINKDROP_API_KEY"
COMMAND="${1:-open my terminal}"

echo "Testing Nut.js API with command: $COMMAND"
echo "Using API Key: ${API_KEY:0:8}..." # Show first 8 chars only
echo ""

curl -X POST http://localhost:4000/api/nutjs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{\"command\": \"$COMMAND\"}" \
  -s | jq '.'
