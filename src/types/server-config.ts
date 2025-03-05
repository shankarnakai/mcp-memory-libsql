/**
 * Server configuration types
 */

/**
 * SSE options interface
 */
export interface SseOptions {
  port: number;
  host?: string;
  cors?: boolean;
}

/**
 * Server configuration interface
 */
export interface ServerConfig {
  name: string;
  version: string;
  transport: 'stdio' | 'sse';
  sseOptions?: SseOptions;
}