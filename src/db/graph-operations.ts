import { Entity } from '../types/index.js';
import { DatabaseClient, GraphResult } from './types.js';
import { getRecentEntities, searchEntities, searchSimilar } from './entity-operations.js';
import { getRelationsForEntities } from './relation-operations.js';
import { generateEmbedding } from './embedding-service.js';
import { logger } from '../utils/logger.js';

/**
 * Reads the recent entities and their relations to form a graph
 * @param client - Database client instance
 * @param limit - Maximum number of recent entities to include
 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
 * @returns Graph result with entities and relations
 */
export async function readGraph(
	client: DatabaseClient,
	limit = 10,
	includeEmbeddings = false,
): Promise<GraphResult> {
	const recentEntities = await getRecentEntities(client, limit, includeEmbeddings);
	const entityNames = recentEntities.map(entity => entity.name);
	const relations = await getRelationsForEntities(client, entityNames);
	
	return {
		entities: recentEntities,
		relations
	};
}

/**
 * Searches for nodes in the graph by text query or vector similarity
 * @param client - Database client instance
 * @param query - Text query or vector embedding for search
 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
 * @returns Graph result with matching entities and their relations
 */
export async function searchNodes(
	client: DatabaseClient,
	query: string | number[],
	includeEmbeddings = false,
): Promise<GraphResult> {
	try {
		let entities: Entity[];

		if (Array.isArray(query)) {
			// Validate vector query
			if (!query.every((n) => typeof n === 'number')) {
				throw new Error('Vector query must contain only numbers');
			}
			
			// Vector similarity search
			const results = await searchSimilar(client, query, 5, includeEmbeddings);
			entities = results.map((r) => r.entity);
		} else {
			// Validate text query
			if (typeof query !== 'string') {
				throw new Error('Text query must be a string');
			}
			if (query.trim() === '') {
				throw new Error('Text query cannot be empty');
			}
			
			try {
				// Try semantic search first by generating an embedding for the text query
				logger.info(`Generating embedding for text query: "${query}"`);
				const embedding = await generateEmbedding(query);
				
				// Vector similarity search using the generated embedding
				logger.info(`Performing semantic search with generated embedding`);
				const results = await searchSimilar(client, embedding, 5, includeEmbeddings);
				entities = results.map((r) => r.entity);
				
				// If we got results, return them
				if (entities.length > 0) {
					logger.info(`Found ${entities.length} entities via semantic search`);
				} else {
					// Fall back to text search if no results from semantic search
					logger.info(`No results from semantic search, falling back to text search`);
					// Text-based search
					entities = await searchEntities(client, query, includeEmbeddings);
				}
			} catch (embeddingError) {
				// If embedding generation fails, fall back to text search
				logger.error(`Failed to generate embedding for query, falling back to text search:`, embeddingError);
				
				// Text-based search
				entities = await searchEntities(client, query, includeEmbeddings);
			}
		}

		// If no entities found, return empty result
		if (entities.length === 0) {
			return { entities: [], relations: [] };
		}

		const entityNames = entities.map(entity => entity.name);
		const relations = await getRelationsForEntities(client, entityNames);
		return { entities, relations };
	} catch (error) {
		throw new Error(
			`Node search failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}