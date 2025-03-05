#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ServerTransport } from './transports/transport.js';
import { SseServerTransport } from './transports/sse-transport.js';
import { TransportAdapter } from './transports/transport-adapter.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { serverConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { toMcpError } from './utils/errors.js';
import { databaseService } from './services/database-service.js';
import { embeddingService } from './services/embedding-service.js';
import { createEntities, deleteEntity } from './services/entity-service.js';
import { createRelations, deleteRelation } from './services/relation-service.js';
import { readGraph, searchNodes } from './services/graph-service.js';

/**
 * Main MCP server class for memory operations
 */
class MemoryServer {
  private server: Server;

  constructor() {
    // Initialize the MCP server
    this.server = new Server(
      {
        name: serverConfig.name,
        version: serverConfig.version,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Set up request handlers
    this.setupToolHandlers();
    
    // Set up error handling
    this.server.onerror = (error) => {
      logger.error('MCP Server Error:', error);
    };

    // Set up process signal handling
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal, shutting down...');
      await this.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal, shutting down...');
      await this.close();
      process.exit(0);
    });
  }

  /**
   * Set up tool handlers for the MCP server
   */
  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_entities',
          description: 'Create new entities with observations and optional embeddings',
          inputSchema: {
            type: 'object',
            properties: {
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                    },
                    entityType: {
                      type: 'string',
                    },
                    observations: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                    embedding: {
                      type: 'array',
                      items: {
                        type: 'number',
                      },
                      description: 'Optional vector embedding for similarity search',
                    },
                    relations: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          target: {
                            type: 'string',
                          },
                          relationType: {
                            type: 'string',
                          },
                        },
                        required: [
                          'target',
                          'relationType',
                        ],
                      },
                      description: 'Optional relations to create with this entity',
                    },
                  },
                  required: [
                    'name',
                    'entityType',
                    'observations',
                  ],
                },
              },
            },
            required: [
              'entities',
            ],
          },
        },
        {
          name: 'search_nodes',
          description: 'Search for entities and their relations using text or vector similarity',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                oneOf: [
                  {
                    type: 'string',
                    description: 'Text search query',
                  },
                  {
                    type: 'array',
                    items: {
                      type: 'number',
                    },
                    description: 'Vector for similarity search',
                  },
                ],
              },
              includeEmbeddings: {
                type: 'boolean',
                description: 'Whether to include embeddings in the returned entities (default: false)',
              },
            },
            required: [
              'query',
            ],
          },
        },
        {
          name: 'read_graph',
          description: 'Get recent entities and their relations',
          inputSchema: {
            type: 'object',
            properties: {
              includeEmbeddings: {
                type: 'boolean',
                description: 'Whether to include embeddings in the returned entities (default: false)',
              },
            },
            required: [],
          },
        },
        {
          name: 'create_relations',
          description: 'Create relations between entities',
          inputSchema: {
            type: 'object',
            properties: {
              relations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    source: {
                      type: 'string',
                    },
                    target: {
                      type: 'string',
                    },
                    type: {
                      type: 'string',
                    },
                  },
                  required: [
                    'source',
                    'target',
                    'type',
                  ],
                },
              },
            },
            required: [
              'relations',
            ],
          },
        },
        {
          name: 'delete_entity',
          description: 'Delete an entity and all its associated data (observations and relations)',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the entity to delete',
              },
            },
            required: [
              'name',
            ],
          },
        },
        {
          name: 'delete_relation',
          description: 'Delete a specific relation between entities',
          inputSchema: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                description: 'Source entity name',
              },
              target: {
                type: 'string',
                description: 'Target entity name',
              },
              type: {
                type: 'string',
                description: 'Type of relation',
              },
            },
            required: [
              'source',
              'target',
              'type',
            ],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args = {} } = request.params;
        logger.info(`Tool call: ${name}`, args);

        // Define interfaces for tool arguments
        interface EntityInput {
          name: string;
          entityType: string;
          observations: string[];
          embedding?: number[];
          relations?: Array<{
            target: string;
            relationType: string;
          }>;
        }

        interface SearchNodesInput {
          query: string | number[];
          includeEmbeddings?: boolean;
        }

        interface ReadGraphInput {
          includeEmbeddings?: boolean;
        }

        interface RelationInput {
          source: string;
          target: string;
          type: string;
        }

        interface DeleteEntityInput {
          name: string;
        }

        interface DeleteRelationInput {
          source: string;
          target: string;
          type: string;
        }

        switch (name) {
          case 'create_entities': {
            // Define the expected type for entities
            interface EntityInput {
              name: string;
              entityType: string;
              observations: string[];
              embedding?: number[];
              relations?: Array<{
                target: string;
                relationType: string;
              }>;
            }
            
            // Type assertion with proper interface
            const entities = args.entities as EntityInput[];
            await createEntities(entities);
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully processed ${entities.length} entities (created new or updated existing)`,
                },
              ],
            };
          }

          case 'search_nodes': {
            // Safely access properties with type assertions for each property
            if (!args.query) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Missing required parameter: query'
              );
            }
            
            const query = args.query as string | number[];
            const includeEmbeddings = args.includeEmbeddings as boolean || false;
            
            const result = await searchNodes(query, includeEmbeddings);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'read_graph': {
            // Safely access properties with type assertions
            const includeEmbeddings = args.includeEmbeddings as boolean || false;
            
            // Use a fixed limit of 10 for the number of entities to return
            const result = await readGraph(10, includeEmbeddings);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'create_relations': {
            // Define the expected type for relations
            interface RelationInput {
              source: string;
              target: string;
              type: string;
            }
            
            // Type assertion with proper interface
            const relationInputs = args.relations as RelationInput[];
            
            // Map to the format expected by createRelations
            const relations = relationInputs.map(rel => ({
              from: rel.source,
              to: rel.target,
              relationType: rel.type,
            }));
            
            await createRelations(relations);
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully created ${relations.length} relations`,
                },
              ],
            };
          }

          case 'delete_entity': {
            // Safely access properties with type assertions
            if (!args.name) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Missing required parameter: name'
              );
            }
            
            const name = args.name as string;
            await deleteEntity(name);
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully deleted entity: ${name}`,
                },
              ],
            };
          }

          case 'delete_relation': {
            // Safely access properties with type assertions
            if (!args.source || !args.target || !args.type) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Missing required parameters: source, target, or type'
              );
            }
            
            const source = args.source as string;
            const target = args.target as string;
            const type = args.type as string;
            
            await deleteRelation(source, target, type);
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully deleted relation: ${source} -> ${target} (${type})`,
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        logger.error('Error handling tool call:', error);
        const mcpError = toMcpError(error);
        
        return {
          content: [
            {
              type: 'text',
              text: mcpError.message,
            },
          ],
          isError: true,
        };
      }
    });

    // We don't use resources, but we need to handle these requests
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [],
    }));

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Resource not found: ${request.params.uri}`
      );
    });
  }

  /**
   * Initialize the server and database
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('Initializing database...');
      await databaseService.initialize();
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Connect to the MCP transport
   * @param transport - The MCP transport to connect to
   */
  public async connect(transport: ServerTransport): Promise<void> {
    try {
      logger.info('Connecting to MCP transport...');
      // Use type assertion to convert ServerTransport to any
      // This is a workaround for the type incompatibility issue
      await this.server.connect(transport as any);
      logger.info('Connected to MCP transport successfully');
    } catch (error) {
      logger.error('Failed to connect to MCP transport:', error);
      throw error;
    }
  }

  /**
   * Close the server and database connection
   */
  public async close(): Promise<void> {
    try {
      logger.info('Closing server...');
      await this.server.close();
      logger.info('Server closed successfully');
      
      logger.info('Closing database connection...');
      await databaseService.close();
      logger.info('Database connection closed successfully');
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }

  /**
   * Run the server
   */
  public async run(): Promise<void> {
    try {
      // Initialize the server
      await this.initialize();
      
      // Connect to the MCP transport based on configuration
      if (serverConfig.transport === 'sse') {
        logger.info('Using SSE transport');
        // Use the SseServerTransport directly with a type assertion
        // This is a workaround for the type incompatibility issue
        const transport = new SseServerTransport();
        
        // Start the SSE transport server before connecting
        // This is necessary because the HTTP server needs to be running
        // before we can connect to it
        logger.info('Starting SSE transport server...');
        await transport.start();
        
        await this.connect(transport);
        logger.info(`${serverConfig.name} v${serverConfig.version} running on SSE transport`);
      } else {
        // Default to stdio transport
        logger.info('Using stdio transport');
        const transport = new StdioServerTransport();
        // Use the server.connect method directly for StdioServerTransport
        // since it's already compatible with the MCP SDK's Transport interface
        await this.server.connect(transport);
        logger.info(`${serverConfig.name} v${serverConfig.version} running on stdio`);
      }
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Create and run the server
const server = new MemoryServer();
server.run().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
