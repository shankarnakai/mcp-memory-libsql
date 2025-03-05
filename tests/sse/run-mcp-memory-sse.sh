#!/bin/bash

# Script to run mcp-memory-libsql server with SSE transport

# Set environment variables for SSE transport
export TRANSPORT_TYPE=sse
export SSE_PORT=3000
export SSE_HOST=localhost
export SSE_CORS=true

# Path to the mcp-memory-libsql server
SERVER_PATH="../../dist/index.js"

# Check if the server exists
if [ ! -f "$SERVER_PATH" ]; then
    echo "Error: Server not found at $SERVER_PATH"
    echo "Make sure you have built the project with 'npm run build'"
    exit 1
fi

# Run the server with SSE transport
echo "Starting mcp-memory-libsql server with SSE transport..."
echo "SSE endpoint: http://$SSE_HOST:$SSE_PORT/mcp/events"
echo "Request endpoint: http://$SSE_HOST:$SSE_PORT/mcp/request"
echo "Press Ctrl+C to stop the server"
echo ""

node "$SERVER_PATH"