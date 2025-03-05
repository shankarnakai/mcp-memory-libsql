import { createClient } from '@libsql/client';
import { DatabaseClient, DatabaseConfig } from './types.js';
import { logger } from '../utils/logger.js';
import { EMBEDDING_DIMENSION } from '../services/embedding-service.js';
import {
	createEntities,
	getEntity,
	getRecentEntities,
	deleteEntity
} from '../services/entity-service.js';
import { searchSimilar, searchEntities } from './index.js';
import {
	createRelations,
	deleteRelation,
	getRelationsForEntities
} from '../services/relation-service.js';
import {
	readGraph,
	searchNodes
} from '../services/graph-service.js';
import { Entity, Relation, SearchResult } from '../types/index.js';

/**
 * Core DatabaseManager class that handles database connection and initialization
 */
export class DatabaseManager {
	private static instance: DatabaseManager;
	private client: any; // Using any due to type incompatibility between libsql Client and DatabaseClient

	/**
	 * Private constructor to enforce singleton pattern
	 * @param config - Database configuration
	 */
	private constructor(config: DatabaseConfig) {
		if (!config.url) {
			throw new Error('Database URL is required');
		}
		this.client = createClient({
			url: config.url,
			authToken: config.authToken,
		});
	}

	/**
	 * Gets the singleton instance of DatabaseManager
	 * @param config - Database configuration
	 * @returns DatabaseManager instance
	 */
	public static async getInstance(
		config: DatabaseConfig,
	): Promise<DatabaseManager> {
		if (!DatabaseManager.instance) {
			DatabaseManager.instance = new DatabaseManager(config);
			await DatabaseManager.instance.initialize();
		}
		return DatabaseManager.instance;
	}

	/**
	 * Gets the singleton instance of DatabaseManager (snake_case alias for backward compatibility)
	 * @param config - Database configuration
	 * @returns DatabaseManager instance
	 */
	public static async get_instance(
		config: DatabaseConfig,
	): Promise<DatabaseManager> {
		return DatabaseManager.getInstance(config);
	}

	/**
	 * Gets the database client
	 * @returns Database client
	 */
	public getClient(): DatabaseClient {
		return this.client as unknown as DatabaseClient;
	}

	/**
	 * Gets the database client (snake_case alias for backward compatibility)
	 * @returns Database client
	 */
	public get_client(): DatabaseClient {
		return this.client as unknown as DatabaseClient;
	}

	/**
	 * Initializes the database schema
	 */
	public async initialize(): Promise<void> {
		try {
			logger.info(`Initializing database schema with vector dimension: ${EMBEDDING_DIMENSION}`);
			
			// Create tables if they don't exist - each as a single statement
			await this.client.execute({
				sql: `
					CREATE TABLE IF NOT EXISTS entities (
						name TEXT PRIMARY KEY,
						entity_type TEXT NOT NULL,
						embedding F32_BLOB(${EMBEDDING_DIMENSION}), -- Using configurable dimension
						created_at DATETIME DEFAULT CURRENT_TIMESTAMP
					)
				`
			});

			await this.client.execute({
				sql: `
					CREATE TABLE IF NOT EXISTS observations (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						entity_name TEXT NOT NULL,
						content TEXT NOT NULL,
						created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
						FOREIGN KEY (entity_name) REFERENCES entities(name)
					)
				`
			});

			await this.client.execute({
				sql: `
					CREATE TABLE IF NOT EXISTS relations (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						source TEXT NOT NULL,
						target TEXT NOT NULL,
						relation_type TEXT NOT NULL,
						created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
						FOREIGN KEY (source) REFERENCES entities(name),
						FOREIGN KEY (target) REFERENCES entities(name)
					)
				`
			});

			// Create all indexes in a single batch transaction
			await this.client.batch(
				[
					{
						sql: 'CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)',
						args: [],
					},
					{
						sql: 'CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name)',
						args: [],
					},
					{
						sql: 'CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source)',
						args: [],
					},
					{
						sql: 'CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target)',
						args: [],
					},
					{
						sql: 'CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities(libsql_vector_idx(embedding))',
						args: [],
					},
				],
				'write',
			);
		} catch (error) {
			throw new Error(
				`Database initialization failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	/**
	 * Creates or updates entities with observations and optional embeddings
	 * @param entities - Array of entities to create or update
	 */
	async create_entities(
		entities: Array<{
			name: string;
			entityType: string;
			observations: string[];
			embedding?: number[];
		}>,
	): Promise<void> {
		return createEntities(entities);
	}

	/**
	 * Searches for entities by similarity to the provided embedding vector
	 * @param embedding - Vector embedding to search with
	 * @param limit - Maximum number of results to return
	 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
	 * @returns Array of search results with entities and distance scores
	 */
	async search_similar(
		embedding: number[],
		limit: number = 5,
		includeEmbeddings: boolean = false,
	): Promise<SearchResult[]> {
		const client = this.getClient();
		return searchSimilar(client, embedding, limit, includeEmbeddings);
	}

	/**
	 * Gets an entity by name
	 * @param name - Name of the entity to retrieve
	 * @param includeEmbeddings - Whether to include embeddings in the returned entity (default: false)
	 * @returns Entity object with observations and optional embedding
	 */
	async get_entity(name: string, includeEmbeddings: boolean = false): Promise<Entity> {
		return getEntity(name, includeEmbeddings);
	}

	/**
	 * Searches for entities by text query in name, type, or observations
	 * @param query - Text query to search for
	 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
	 * @returns Array of matching entities
	 */
	async search_entities(query: string, includeEmbeddings: boolean = false): Promise<Entity[]> {
		const client = this.getClient();
		return searchEntities(client, query, includeEmbeddings);
	}

	/**
	 * Gets the most recently created entities
	 * @param limit - Maximum number of entities to return
	 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
	 * @returns Array of recent entities
	 */
	async get_recent_entities(limit = 10, includeEmbeddings: boolean = false): Promise<Entity[]> {
		return getRecentEntities(limit, includeEmbeddings);
	}

	/**
	 * Creates relations between entities
	 * @param relations - Array of relations to create
	 */
	async create_relations(relations: Relation[]): Promise<void> {
		return createRelations(relations);
	}

	/**
	 * Deletes an entity and all its associated data
	 * @param name - Name of the entity to delete
	 */
	async delete_entity(name: string): Promise<void> {
		return deleteEntity(name);
	}

	/**
	 * Deletes a specific relation between entities
	 * @param source - Source entity name
	 * @param target - Target entity name
	 * @param type - Relation type
	 */
	async delete_relation(
		source: string,
		target: string,
		type: string,
	): Promise<void> {
		return deleteRelation(source, target, type);
	}

	/**
	 * Gets relations for a set of entities
	 * @param entities - Array of entities to get relations for
	 * @returns Array of relations
	 */
	async get_relations_for_entities(
		entities: Entity[],
	): Promise<Relation[]> {
		const entityNames = entities.map(entity => entity.name);
		return getRelationsForEntities(entityNames);
	}

	/**
	 * Reads the recent entities and their relations to form a graph
	 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
	 * @returns Graph result with entities and relations
	 */
	async read_graph(includeEmbeddings: boolean = false): Promise<{
		entities: Entity[];
		relations: Relation[];
	}> {
		return readGraph(10, includeEmbeddings);
	}

	/**
	 * Searches for nodes in the graph by text query or vector similarity
	 * @param query - Text query or vector embedding for search
	 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
	 * @returns Graph result with matching entities and their relations
	 */
	async search_nodes(
		query: string | number[],
		includeEmbeddings: boolean = false,
	): Promise<{ entities: Entity[]; relations: Relation[] }> {
		return searchNodes(query, includeEmbeddings);
	}

	/**
	 * Closes the database connection
	 */
	public async close(): Promise<void> {
		try {
			await this.client.close();
		} catch (error) {
			logger.error('Error closing database connection:', error);
		}
	}
}

export type { DatabaseConfig };