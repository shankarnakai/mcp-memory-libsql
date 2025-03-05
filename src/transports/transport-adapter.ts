// Define our own Transport interface that matches what the MCP SDK expects
export interface Transport {
  start(): Promise<void>;
  close(): Promise<void>;
  send(message: any): Promise<void>;
  onmessage(callback: (message: any) => void): void;
}
import { ServerTransport } from './transport.js';

/**
 * Adapter class to adapt our ServerTransport interface to the Transport interface used by the MCP SDK
 */
export class TransportAdapter implements Transport {
  private transport: ServerTransport;

  constructor(transport: ServerTransport) {
    this.transport = transport;
  }

  /**
   * Start the transport (required by MCP SDK Transport interface)
   * This maps to our start method
   */
  public async start(): Promise<void> {
    await this.transport.start();
  }

  /**
   * Close the transport (required by MCP SDK Transport interface)
   * This maps to our close method
   */
  public async close(): Promise<void> {
    await this.transport.close();
  }

  /**
   * Send a message to the client (required by MCP SDK Transport interface)
   * This maps to our send method
   * @param message - The message to send
   */
  public async send(message: any): Promise<void> {
    // Convert the message to a string if it's not already
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    await this.transport.send(messageStr);
  }

  /**
   * Set the message callback (required by MCP SDK Transport interface)
   * This maps to our onmessage method
   * @param callback - The callback to call when a message is received
   */
  public onmessage(callback: (message: any) => void): void {
    // Wrap the callback to handle string messages
    this.transport.onmessage((message: string) => {
      try {
        // Try to parse the message as JSON
        const jsonMessage = JSON.parse(message);
        callback(jsonMessage);
      } catch (error) {
        // If parsing fails, just pass the string
        callback(message);
      }
    });
  }
}

/**
 * Adapter class to adapt the StdioServerTransport to our ServerTransport interface
 */
export class StdioTransportAdapter implements ServerTransport {
  private transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  /**
   * Start the transport
   * This maps to the start method of the Transport interface
   */
  public async start(): Promise<void> {
    await this.transport.start();
  }

  /**
   * Close the transport
   * This maps to the close method of the Transport interface
   */
  public async close(): Promise<void> {
    await this.transport.close();
  }

  /**
   * Send a message to the client
   * This maps to the send method of the Transport interface
   * @param message - The message to send
   */
  public async send(message: string): Promise<void> {
    await this.transport.send(message);
  }

  /**
   * Set the message callback
   * This maps to the onmessage method of the Transport interface
   * @param callback - The callback to call when a message is received
   */
  public onmessage(callback: (message: string) => void): void {
    this.transport.onmessage(callback);
  }
}