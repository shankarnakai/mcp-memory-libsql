import { databaseService } from './database-service.js';
import { embeddingService } from './embedding-service.js';
import { logger } from '../utils/logger.js';
import { DatabaseError, ValidationError } from '../utils/errors.js';
import { Entity, GraphResult } from '../models/index.js';
import { getEntity, getRecentEntities } from './entity-service.js';
import { getRelationsForEntities } from './relation-service.js';

/** Similarity threshold for matching observations (cosine distance). Smaller = stricter. */
const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD ?? '0.4');

/** Maximum number of entities to return from search */
const MAX_RESULTS = Number(process.env.SIMILARITY_MAX_RESULTS ?? '10');

/**
 * Graph service for managing graph operations
 */
export class GraphService {
  /**
   * Reads the recent entities and their relations to form a graph
   * @param limit - Maximum number of recent entities to include
   * @returns Graph result with entities and relations
   */
  public static async readGraph(limit = 10): Promise<GraphResult> {
    try {
      // Get recent entities
      const recentEntities = await getRecentEntities(limit);

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
   * Searches observation embeddings and ranks entities by number of matching observations
   * @param query - Text query or vector embedding for search
   * @returns Graph result with matching entities and their relations
   */
  public static async searchNodes(query: string | number[]): Promise<GraphResult> {
    try {
      // Ensure database schema exists even if caller forgot to initialize the service
      await databaseService.initialize();

      let entityNames: string[] = [];

      if (Array.isArray(query)) {
        // Validate vector query
        if (!query.every((n) => typeof n === 'number')) {
          throw new ValidationError('Vector query must contain only numbers');
        }

        // Vector similarity search on observations, fallback to empty result if vector search fails
        try {
          entityNames = await GraphService.searchByVector(query);
        } catch (vectorError) {
          logger.error('Vector search failed, returning no results:', vectorError);
          entityNames = [];
        }
      } else {
        // Validate text query
        if (typeof query !== 'string') {
          throw new ValidationError('Text query must be a string');
        }
        const trimmedQuery = query.trim();
        if (trimmedQuery === '') {
          throw new ValidationError('Text query cannot be empty');
        }

        // Run fuzzy entity name search concurrently with semantic search
        const fuzzyNameSearchPromise = GraphService.searchByEntityNameFuzzy(trimmedQuery)
          .catch((err) => {
            logger.error('Fuzzy entity name search failed:', err);
            return [] as string[];
          });

        try {
          // Generate embedding for text query
          logger.info(`Generating embedding for text query: "${trimmedQuery}"`);
          const embedding = await embeddingService.generateEmbedding(trimmedQuery);

          // Run semantic vector search and await fuzzy name search concurrently
          logger.info(`Performing semantic search with generated embedding (concurrent with fuzzy name search)`);
          const [semanticResults, fuzzyNameResults] = await Promise.all([
            GraphService.searchByVector(embedding).catch((err) => {
              logger.error('Vector search failed:', err);
              return [] as string[];
            }),
            fuzzyNameSearchPromise,
          ]);

          // Merge results: fuzzy name matches first (exact/close name matches are high signal),
          // then semantic results, deduplicated
          entityNames = GraphService.mergeResults(fuzzyNameResults, semanticResults);

          if (entityNames.length > 0) {
            logger.info(`Found ${entityNames.length} entities (${fuzzyNameResults.length} from fuzzy name, ${semanticResults.length} from semantic)`);
          } else {
            // Fallback to broader text search on observations
            logger.info(`No results from semantic or fuzzy name search, falling back to text search`);
            entityNames = await GraphService.searchByText(trimmedQuery);
          }
        } catch (embeddingError) {
          // If embedding generation fails, await fuzzy name results and fall back to text search
          logger.error(`Failed to generate embedding, falling back to fuzzy name + text search:`, embeddingError);
          try {
            const fuzzyNameResults = await fuzzyNameSearchPromise;
            const textResults = await GraphService.searchByText(trimmedQuery);
            entityNames = GraphService.mergeResults(fuzzyNameResults, textResults);
          } catch (textError) {
            // Last-resort: use whatever fuzzy name results we have
            logger.error('Text search failed after embedding fallback:', textError);
            try {
              entityNames = await fuzzyNameSearchPromise;
            } catch {
              entityNames = [];
            }
          }
        }
      }

      // If no entities found, return empty graph
      if (entityNames.length === 0) {
        return { entities: [], relations: [] };
      }

      // Get full entities with ALL observations (not just matching ones)
      const entities = await Promise.all(
        entityNames.map(async (name: string) => getEntity(name))
      );

      // Get relations for these entities
      const relations = await getRelationsForEntities(entityNames);

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

  /**
   * Search observations by vector similarity and return entity names
   * Ranks entities by: (1) number of matching observations, (2) average similarity
   * @param embedding - Query embedding vector
   * @returns Array of entity names ranked by relevance
   */
  private static async searchByVector(embedding: number[]): Promise<string[]> {
    const client = databaseService.getClient();
    const vectorString = JSON.stringify(embedding);

    // Search observations with similarity threshold and aggregate by entity
    // Using CTE to find matching observations, then aggregate and rank
    const results = await client.execute({
      sql: `
        WITH matching_observations AS (
          SELECT
            o.entity_name,
            o.id AS observation_id,
            vector_distance_cos(o.embedding, vector32(?)) AS distance
          FROM observations o
          WHERE o.embedding IS NOT NULL
            AND vector_distance_cos(o.embedding, vector32(?)) <= ?
        ),
        entity_matches AS (
          SELECT
            mo.entity_name,
            COUNT(DISTINCT mo.observation_id) AS match_count,
            AVG(mo.distance) AS avg_distance
          FROM matching_observations mo
          GROUP BY mo.entity_name
        )
        SELECT em.entity_name
        FROM entity_matches em
        ORDER BY em.avg_distance ASC, em.match_count DESC
        LIMIT ?
      `,
      args: [vectorString, vectorString, SIMILARITY_THRESHOLD, MAX_RESULTS],
    });

    return results.rows.map((row: { entity_name: string }) => row.entity_name as string);
  }

  /**
   * Search by text using word-based fuzzy matching
   * Splits query into words and searches for each using LIKE
   * @param query - Text query
   * @returns Array of entity names ranked by relevance
   */
  private static async searchByText(query: string): Promise<string[]> {
    const client = databaseService.getClient();

    // Split query into words for fuzzy matching
    const words = query.trim().split(/\s+/).filter((w) => w.length > 0);

    if (words.length === 0) {
      return [];
    }

    // Build LIKE conditions for each word
    // Each word can match entity name, entity type, or observation content
    const conditions = words
      .map(() => '(e.name LIKE ? OR e.entity_type LIKE ? OR o.content LIKE ?)')
      .join(' OR ');

    // Flatten arguments: each word generates 3 LIKE patterns
    const args = words.flatMap((word) => {
      const pattern = `%${word}%`;
      return [pattern, pattern, pattern];
    });

    // Add limit to args
    args.push(MAX_RESULTS.toString());

    const results = await client.execute({
      sql: `
        SELECT e.name, COUNT(DISTINCT o.id) as match_count
        FROM entities e
        LEFT JOIN observations o ON e.name = o.entity_name
        WHERE ${conditions}
        GROUP BY e.name
        ORDER BY match_count DESC
        LIMIT ?
      `,
      args,
    });

    return results.rows.map((row: { name: string }) => row.name as string);
  }

  /**
   * Fuzzy search on entity names by splitting the query into tokens
   * (by hyphens, underscores, spaces, dots) and matching against entity names.
   * Also matches the full query as an exact/substring match.
   * Results are scored by how many tokens match, with exact matches ranked highest.
   * @param query - Text query to fuzzy match against entity names
   * @returns Array of entity names ranked by relevance
   */
  private static async searchByEntityNameFuzzy(query: string): Promise<string[]> {
    const client = databaseService.getClient();

    // Tokenize the query by common delimiters (hyphens, underscores, spaces, dots)
    const tokens = query
      .trim()
      .split(/[-_\s.]+/)
      .filter((t) => t.length > 0)
      .map((t) => t.toLowerCase());

    if (tokens.length === 0) {
      return [];
    }

    // Build scoring SQL: exact match gets highest priority,
    // then substring match on full query, then token-based matching
    const fullPattern = `%${query.trim()}%`;

    // Each token adds a point if it matches (using LIKE on lowercased name)
    const tokenScoreClauses = tokens
      .map(() => '(CASE WHEN LOWER(e.name) LIKE ? THEN 1 ELSE 0 END)')
      .join(' + ');

    const tokenArgs = tokens.map((t) => `%${t}%`);

    const results = await client.execute({
      sql: `
        SELECT
          e.name,
          (CASE WHEN LOWER(e.name) = ? THEN 100 ELSE 0 END) +
          (CASE WHEN LOWER(e.name) LIKE ? THEN 50 ELSE 0 END) +
          (${tokenScoreClauses}) AS relevance_score
        FROM entities e
        WHERE LOWER(e.name) LIKE ?
          OR (${tokens.map(() => 'LOWER(e.name) LIKE ?').join(' OR ')})
        ORDER BY relevance_score DESC
        LIMIT ?
      `,
      args: [
        query.trim().toLowerCase(),   // exact match check
        fullPattern.toLowerCase(),     // substring match on full query
        ...tokenArgs,                  // token score clauses
        fullPattern.toLowerCase(),     // WHERE: full query substring
        ...tokenArgs,                  // WHERE: individual token matches
        MAX_RESULTS,
      ],
    });

    return results.rows.map((row: { name: string }) => row.name as string);
  }

  /**
   * Merge and deduplicate entity name results from multiple search strategies.
   * Preserves ordering within each list, with earlier lists having higher priority.
   * @param lists - Arrays of entity names to merge, in priority order
   * @returns Deduplicated array of entity names, limited to MAX_RESULTS
   */
  private static mergeResults(...lists: string[][]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const list of lists) {
      for (const name of list) {
        if (!seen.has(name)) {
          seen.add(name);
          merged.push(name);
        }
      }
    }

    return merged.slice(0, MAX_RESULTS);
  }
}

// Export convenience functions
export const readGraph = GraphService.readGraph;
export const searchNodes = GraphService.searchNodes;
