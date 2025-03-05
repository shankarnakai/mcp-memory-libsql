# MCP Memory LibSQL SSE Transport Test

This test setup allows you to verify if the SSE (Server-Sent Events) transport is working properly with the mcp-memory-libsql server. The test consists of two parts:

1. A shell script to run the mcp-memory-libsql server with SSE transport enabled
2. An HTML client to connect to the SSE endpoint and send requests to the server

## Prerequisites

- Node.js installed
- The mcp-memory-libsql server built and available at `../../dist/index.js`

## Running the Test

### Step 1: Start the MCP Memory LibSQL Server with SSE Transport

Run the following command in a terminal:

```bash
./run-mcp-memory-sse.sh
```

This script sets the necessary environment variables to enable SSE transport and runs the server. You should see output indicating that the server is running with SSE transport.

### Step 2: Open the HTML Test Client

Open the `sse-test.html` file in a web browser. You can do this by:

- Double-clicking the file in your file explorer
- Or using a command like `open sse-test.html` or `xdg-open sse-test.html` depending on your operating system

### Step 3: Test the SSE Transport

1. In the HTML client, click the "Connect" button to establish an SSE connection to the server.
2. If the connection is successful, you'll see a "Connected" status with a client ID.
3. Select an operation from the dropdown (Create Entities, Search Nodes, or Read Graph).
4. Click the "Send Request" button to send the request to the server.
5. The response will be displayed in the Event Log section.

## Troubleshooting

If you encounter issues:

1. **Connection Errors**: Make sure the server is running and the SSE endpoint URL is correct (default: http://localhost:3000/mcp/events).
2. **Request Errors**: Check that the request URL is correct (default: http://localhost:3000/mcp/request) and the payload is valid JSON.
3. **Server Errors**: Check the terminal where the server is running for any error messages.

## How It Works

The test setup works as follows:

1. The `run-mcp-memory-sse.sh` script sets the `TRANSPORT_TYPE` environment variable to 'sse', which tells the mcp-memory-libsql server to use SSE transport instead of the default stdio transport.
2. The server starts an HTTP server with two endpoints:
   - `/mcp/events`: SSE endpoint for clients to connect and receive messages
   - `/mcp/request`: HTTP endpoint for clients to send requests
3. The HTML client connects to the SSE endpoint using the EventSource API and sends requests to the request endpoint using fetch.

## Implementation Details

Based on the memory search results, the SSE transport implementation in mcp-memory-libsql:

1. Uses a wrapper approach to add SSE transport support without major architectural changes
2. Creates an HTTP server with SSE endpoints that forwards requests to the server
3. Implements the ServerTransport interface to match the Transport interface from the MCP SDK
4. Uses type assertions to work around type compatibility issues
5. Maintains backward compatibility with the existing stdio transport

This test verifies that the SSE transport is working correctly and can be used as an alternative to the default stdio transport.