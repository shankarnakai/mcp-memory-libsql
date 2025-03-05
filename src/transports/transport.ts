/**
 * Transport interface for MCP server
 * This interface defines the methods that a transport must implement
 * This matches the Transport interface from the MCP SDK
 */
export interface ServerTransport {
  /**
   * Start the transport
   */
  start(): Promise<void>;

  /**
   * Close the transport
   */
  close(): Promise<void>;

  /**
   * Send a message to the client
   * @param message - The message to send
   */
  send(message: string): Promise<void>;

  /**
   * Set the message callback
   * @param callback - The callback to call when a message is received
   */
  onmessage(callback: (message: string) => void): void;
}