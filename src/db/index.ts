// Export types
export * from './types.js';

// Export core database manager
export { DatabaseManager } from './core.js';

// Export entity operations
export {
	createEntities,
	searchSimilar,
	getEntity,
	searchEntities,
	getRecentEntities,
	deleteEntity,
} from './entity-operations.js';

// Export relation operations
export {
	createRelations,
	deleteRelation,
	getRelationsForEntities,
} from './relation-operations.js';

// Export graph operations
export {
	readGraph,
	searchNodes,
} from './graph-operations.js';

// Export vector utilities
export {
	arrayToVectorString,
	extractVector,
} from './vector-utils.js';