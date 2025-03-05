// Re-export types
export * from './types.js';

// Re-export core database manager for backward compatibility
export { DatabaseManager } from './core.js';

// Re-export entity operations from services layer
export {
	createEntities,
	getEntity,
	getRecentEntities,
	deleteEntity,
} from '../services/entity-service.js';

// Re-export relation operations from services layer
export {
	createRelations,
	deleteRelation,
	getRelationsForEntities,
} from '../services/relation-service.js';

// Re-export graph operations from services layer
export {
	readGraph,
	searchNodes,
} from '../services/graph-service.js';

// Re-export vector utilities from services layer
export {
	arrayToVectorString,
	extractVector,
	cosineSimilarity,
	euclideanDistance,
} from '../services/vector-service.js';

// Re-export embedding service functions for backward compatibility
export {
	EMBEDDING_DIMENSION as DEFAULT_EMBEDDING_DIMENSION,
} from '../services/embedding-service.js';

// Re-export embedding functions
export const generateEmbedding = async (input: string, modelName?: string): Promise<number[]> => {
	const { embeddingService } = await import('../services/embedding-service.js');
	return embeddingService.generateEmbedding(input);
};

export const generateEmbeddings = async (inputs: string[], modelName?: string): Promise<number[][]> => {
	const { embeddingService } = await import('../services/embedding-service.js');
	return embeddingService.generateEmbeddings(inputs);
};

// Re-export searchSimilar function for backward compatibility
export const searchSimilar = async (
	client: any,
	embedding: number[],
	limit: number = 5,
	includeEmbeddings: boolean = false,
): Promise<any[]> => {
	// This is a compatibility wrapper that adapts the new service API to the old function signature
	const { databaseService } = await import('../services/database-service.js');
	const { searchNodes } = await import('../services/graph-service.js');
	
	// Use the searchNodes function with the vector embedding
	const result = await searchNodes(embedding, includeEmbeddings);
	
	// Convert the result to the format expected by the old API
	return result.entities.map(entity => ({
		entity,
		distance: 0, // We don't have distance information in the new API
	}));
};

// Re-export searchEntities function for backward compatibility
export const searchEntities = async (
	client: any,
	query: string,
	includeEmbeddings: boolean = false,
): Promise<any[]> => {
	// This is a compatibility wrapper that adapts the new service API to the old function signature
	const { searchNodes } = await import('../services/graph-service.js');
	
	// Use the searchNodes function with the text query
	const result = await searchNodes(query, includeEmbeddings);
	
	// Return just the entities
	return result.entities;
};