import { databaseService } from './database-service.js';
import { embeddingService } from './embedding-service.js';
import { logger } from '../utils/logger.js';
import { DatabaseError, ValidationError } from '../utils/errors.js';
import { Entity, GraphResult } from '../models/index.js';
import { EntityService, getEntity, getRecentEntities } from './entity-service.js';
import { getRelationsForEntities } from './relation-service.js';

/**
 * Graph service for managing graph operations
 */
export class GraphService {
  /**
   * Reads the recent entities and their relations to form a graph
   * @param limit - Maximum number of recent entities to include
   * @param includeEmbeddings - Whether to include embeddings in the returned entities
   * @returns Graph result with entities and relations
   */
  public static async readGraph(
    limit = 10,
    includeEmbeddings = false,
  ): Promise<GraphResult> {
    try {
      // Get recent entities
      const recentEntities = await getRecentEntities(limit, includeEmbeddings);
      
      // If no entities found, return empty graph
      if (!recentEntities || recentEntities.length === 0) {
        return {
          entities: [],
          relations: [],
        };
      }
      
      // Get entity names
      const entityNames = recentEntities.map((entity: Entity) => entity.name);
      
      // Get relations for these entities
      const relations = await getRelationsForEntities(entityNames);
      
      // Return graph result
      return {
        entities: recentEntities,
        relations,
      };
    } catch (error) {
      throw new DatabaseError(
        `Failed to read graph: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Searches for nodes in the graph by text query or vector similarity
   * @param query - Text query or vector embedding for search
   * @param includeEmbeddings - Whether to include embeddings in the returned entities
   * @returns Graph result with matching entities and their relations
   */
  public static async searchNodes(
    query: string | number[],
    includeEmbeddings = false,
  ): Promise<GraphResult> {
    try {
      let entities: Entity[] = [];

      if (Array.isArray(query)) {
        // Validate vector query
        if (!query.every((n) => typeof n === 'number')) {
          throw new ValidationError('Vector query must contain only numbers');
        }
        
        // Vector similarity search
        const client = databaseService.getClient();
        const results = await client.execute({
          sql: `
            SELECT e.name
            FROM entities e
            WHERE e.embedding IS NOT NULL
            ORDER BY vector_distance_cos(e.embedding, vector32(?)) ASC
            LIMIT 5
          `,
          args: [JSON.stringify(query)],
        });
        
        // Get full entities with observations
        entities = await Promise.all(
          results.rows.map(async (row: { name: string }) => 
            getEntity(row.name as string, includeEmbeddings)
          )
        );
      } else {
        // Validate text query
        if (typeof query !== 'string') {
          throw new ValidationError('Text query must be a string');
        }
        if (query.trim() === '') {
          throw new ValidationError('Text query cannot be empty');
        }
        
        try {
          // Try semantic search first by generating an embedding for the text query
          logger.info(`Generating embedding for text query: "${query}"`);
          const embedding = await embeddingService.generateEmbedding(query);
          
          // Vector similarity search using the generated embedding
          logger.info(`Performing semantic search with generated embedding`);
          const client = databaseService.getClient();
          const results = await client.execute({
            sql: `
              SELECT e.name
              FROM entities e
              WHERE e.embedding IS NOT NULL
              ORDER BY vector_distance_cos(e.embedding, vector32(?)) ASC
              LIMIT 5
            `,
            args: [JSON.stringify(embedding)],
          });
          
          // Get full entities with observations
          entities = await Promise.all(
            results.rows.map(async (row: { name: string }) => 
              getEntity(row.name as string, includeEmbeddings)
            )
          );
          
          // If we got results, return them
          if (entities.length > 0) {
            logger.info(`Found ${entities.length} entities via semantic search`);
          } else {
            // Fall back to text search if no results from semantic search
            logger.info(`No results from semantic search, falling back to text search`);
            
            // Text-based search
            const client = databaseService.getClient();
            const results = await client.execute({
              sql: `
                SELECT DISTINCT e.name
                FROM entities e
                LEFT JOIN observations o ON e.name = o.entity_name
                WHERE e.name LIKE ? OR e.entity_type LIKE ? OR o.content LIKE ?
                LIMIT 5
              `,
              args: [`%${query}%`, `%${query}%`, `%${query}%`],
            });
            
            // Get full entities with observations
            entities = await Promise.all(
              results.rows.map(async (row: { name: string }) => 
                getEntity(row.name as string, includeEmbeddings)
              )
            );
          }
        } catch (embeddingError) {
          // If embedding generation fails, fall back to text search
          logger.error(`Failed to generate embedding for query, falling back to text search:`, embeddingError);
          
          // Text-based search
          const client = databaseService.getClient();
          const results = await client.execute({
            sql: `
              SELECT DISTINCT e.name
              FROM entities e
              LEFT JOIN observations o ON e.name = o.entity_name
              WHERE e.name LIKE ? OR e.entity_type LIKE ? OR o.content LIKE ?
              LIMIT 5
            `,
            args: [`%${query}%`, `%${query}%`, `%${query}%`],
          });
          
          // Get full entities with observations
          entities = await Promise.all(
            results.rows.map(async (row: { name: string }) => 
              getEntity(row.name as string, includeEmbeddings)
            )
          );
        }
      }

      // If no entities found, return empty graph
      if (entities.length === 0) {
        return { entities: [], relations: [] };
      }

      // Get entity names
      const entityNames = entities.map((entity: Entity) => entity.name);
      
      // Get relations for these entities
      const relations = await getRelationsForEntities(entityNames);
      
      // Return graph result
      return { entities, relations };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError(
        `Node search failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

// Export convenience functions
export const readGraph = GraphService.readGraph;
export const searchNodes = GraphService.searchNodes;