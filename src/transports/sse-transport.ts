import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { serverConfig } from '../config/index.js';
import { ServerTransport } from './transport.js';
import { SseOptions } from '../types/server-config.js';

/**
 * SSE Server Transport for MCP
 * This transport uses Server-Sent Events (SSE) to communicate with clients
 */
export class SseServerTransport implements ServerTransport {
  private app: express.Application;
  private server: any;
  private clients: Map<string, Response> = new Map();
  private messageQueue: string[] = [];
  private onMessageCallback: ((message: string) => void) | null = null;

  constructor() {
    this.app = express();
    
    // Get SSE options from config
    const sseOptions: SseOptions = serverConfig.sseOptions || {
      port: 3000,
      host: 'localhost',
      cors: true
    };
    
    // Configure Express
    this.app.use(cors({
      origin: sseOptions.cors === false ? false : '*',
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type'],
    }));
    this.app.use(express.json());
    
    // Set up routes
    this.setupRoutes();
  }

  /**
   * Set up Express routes for SSE
   */
  private setupRoutes(): void {
    // SSE endpoint for clients to connect
    this.app.get('/mcp/events', (req: Request, res: Response) => {
      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      
      const clientId = uuidv4();
      this.clients.set(clientId, res);
      
      // Send initial connection message
      res.write(`data: ${JSON.stringify({ type: 'connection', clientId })}\n\n`);
      
      // Handle client disconnect
      req.on('close', () => {
        this.clients.delete(clientId);
        logger.info(`SSE client disconnected: ${clientId}`);
      });
      
      logger.info(`SSE client connected: ${clientId}`);
    });
    
    // Endpoint to receive messages from clients
    this.app.post('/mcp/request', (req: Request, res: Response) => {
      try {
        const message = JSON.stringify(req.body);
        
        // If we have a message callback, send the message directly
        if (this.onMessageCallback) {
          this.onMessageCallback(message);
          res.status(200).json({ status: 'success', message: 'Request received' });
        } else {
          // Otherwise, queue the message
          this.messageQueue.push(message);
          res.status(202).json({ status: 'queued', message: 'Request queued' });
        }
      } catch (error) {
        logger.error('Error processing client request:', error);
        res.status(500).json({ status: 'error', message: 'Failed to process request' });
      }
    });
  }

  /**
   * Start the SSE server
   */
  public async start(): Promise<void> {
    return new Promise((resolve) => {
      // Get SSE options from config
      const sseOptions: SseOptions = serverConfig.sseOptions || {
        port: 3000,
        host: 'localhost',
        cors: true
      };
      
      const port = sseOptions.port;
      const host = sseOptions.host || 'localhost';
      
      this.server = this.app.listen(port, host, () => {
        logger.info(`SSE transport server running at http://${host}:${port}`);
        resolve();
      });
    });
  }

  /**
   * Close the SSE server
   */
  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      
      // Close all client connections
      for (const client of this.clients.values()) {
        client.end();
      }
      this.clients.clear();
      
      // Close the server
      this.server.close((err: Error | undefined) => {
        if (err) {
          logger.error('Error closing SSE server:', err);
          reject(err);
        } else {
          logger.info('SSE server closed');
          resolve();
        }
      });
    });
  }

  /**
   * Send a message to all connected clients
   * @param message - The message to send
   */
  public async send(message: string): Promise<void> {
    // Send the message to all connected clients
    for (const client of this.clients.values()) {
      client.write(`data: ${JSON.stringify({ type: 'message', data: message })}\n\n`);
    }
  }

  /**
   * Set the message callback
   * @param callback - The callback to call when a message is received
   */
  public onmessage(callback: (message: string) => void): void {
    this.onMessageCallback = callback;
    
    // Process any queued messages
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.onMessageCallback) {
        this.onMessageCallback(message);
      }
    }
  }
}