import { Entity, SearchResult } from '../types/index.js';
import { DatabaseClient, EntityCreateParams } from './types.js';
import { arrayToVectorString, extractVector } from './vector-utils.js';
import { generateEmbedding } from './embedding-service.js';
import { logger } from '../utils/logger.js';

/**
 * Creates or updates entities with observations and optional embeddings
 * If no embedding is provided, one will be automatically generated from the observations
 * @param client - Database client instance
 * @param entities - Array of entities to create or update
 */
export async function createEntities(
	client: DatabaseClient,
	entities: EntityCreateParams[],
): Promise<void> {
	try {
		for (const entity of entities) {
			// Validate entity name
			if (
				!entity.name ||
				typeof entity.name !== 'string' ||
				entity.name.trim() === ''
			) {
				throw new Error('Entity name must be a non-empty string');
			}

			// Validate entity type
			if (
				!entity.entityType ||
				typeof entity.entityType !== 'string' ||
				entity.entityType.trim() === ''
			) {
				throw new Error(
					`Invalid entity type for entity "${entity.name}"`,
				);
			}

			// Validate observations
			if (
				!Array.isArray(entity.observations) ||
				entity.observations.length === 0
			) {
				throw new Error(
					`Entity "${entity.name}" must have at least one observation`,
				);
			}

			if (
				!entity.observations.every(
					(obs: string) => typeof obs === 'string' && obs.trim() !== '',
				)
			) {
				throw new Error(
					`Entity "${entity.name}" has invalid observations. All observations must be non-empty strings`,
				);
			}

			// Generate embedding if not provided
			let embedding = entity.embedding;
			if (!embedding) {
				try {
					logger.info(`Generating embedding for entity: ${entity.name}`);
					// Join all observations into a single text for embedding
					const text = entity.observations.join(' ');
					embedding = await generateEmbedding(text);
					logger.info(`Successfully generated embedding with dimension: ${embedding.length}`);
				} catch (embeddingError) {
					logger.error(`Failed to generate embedding for entity "${entity.name}":`, embeddingError);
					// Continue with null embedding, will use default zero vector
				}
			}

			// Start a transaction
			const txn = await client.transaction('write');
			
			try {
				// Add debug logging
				console.log(`DEBUG: Entity "${entity.name}" embedding before vectorString: ${embedding ? embedding.length : 'undefined'} dimensions`);
				
				const vectorString = arrayToVectorString(embedding);
				
				// Add debug logging
				console.log(`DEBUG: Entity "${entity.name}" vectorString: ${vectorString.length} characters`);

				// First try to update
				const result = await txn.execute({
					sql: 'UPDATE entities SET entity_type = ?, embedding = vector32(?) WHERE name = ?',
					args: [entity.entityType, vectorString, entity.name],
				});

				// If no rows affected, do insert
				if (result.rowsAffected === 0) {
					await txn.execute({
						sql: 'INSERT INTO entities (name, entity_type, embedding) VALUES (?, ?, vector32(?))',
						args: [entity.name, entity.entityType, vectorString],
					});
				}

				// Clear old observations
				await txn.execute({
					sql: 'DELETE FROM observations WHERE entity_name = ?',
					args: [entity.name],
				});

				// Add new observations
				for (const observation of entity.observations) {
					await txn.execute({
						sql: 'INSERT INTO observations (entity_name, content) VALUES (?, ?)',
						args: [entity.name, observation],
					});
				}

				await txn.commit();
			} catch (error) {
				await txn.rollback();
				throw error;
			}
		}
	} catch (error) {
		// Wrap all errors with context
		throw new Error(
			`Entity operation failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Searches for entities by similarity to the provided embedding vector
 * @param client - Database client instance
 * @param embedding - Vector embedding to search with
 * @param limit - Maximum number of results to return
 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
 * @returns Array of search results with entities and distance scores
 */
export async function searchSimilar(
	client: DatabaseClient,
	embedding: number[],
	limit: number = 5,
	includeEmbeddings = false,
): Promise<SearchResult[]> {
	try {
		// Validate input vector
		if (!Array.isArray(embedding)) {
			throw new Error('Search embedding must be an array');
		}

		const vectorString = arrayToVectorString(embedding);
		const zeroVector = arrayToVectorString(undefined); // Get default zero vector with current dimension

		// Use vector_distance_cos to find similar entities, excluding zero vectors
		const results = await client.execute({
			sql: `
				SELECT e.name, e.entity_type, e.embedding,
					   vector_distance_cos(e.embedding, vector32(?)) as distance
				FROM entities e
				WHERE e.embedding IS NOT NULL
				AND e.embedding != vector32(?)
				ORDER BY distance ASC
				LIMIT ?
			`,
			args: [vectorString, zeroVector, limit],
		});

		// Get observations for each entity
		const searchResults: SearchResult[] = [];
		for (const row of results.rows) {
			try {
				const observations = await client.execute({
					sql: 'SELECT content FROM observations WHERE entity_name = ?',
					args: [row.name],
				});

				const entityEmbedding = includeEmbeddings
					? await extractVector(client, row.embedding as Uint8Array)
					: undefined;

				searchResults.push({
					entity: {
						name: row.name as string,
						entityType: row.entity_type as string,
						observations: observations.rows.map(
							(obs: { content: string }) => obs.content as string,
						),
						embedding: entityEmbedding,
					},
					distance: row.distance as number,
				});
			} catch (error) {
				console.warn(
					`Failed to process search result for entity "${
						row.name
					}": ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				// Continue processing other results
				continue;
			}
		}

		return searchResults;
	} catch (error) {
		throw new Error(
			`Similarity search failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Gets an entity by name
 * @param client - Database client instance
 * @param name - Name of the entity to retrieve
 * @param includeEmbeddings - Whether to include embeddings in the returned entity (default: false)
 * @returns Entity object with observations and optional embedding
 */
export async function getEntity(
	client: DatabaseClient,
	name: string,
	includeEmbeddings = false,
): Promise<Entity> {
	const entityResult = await client.execute({
		sql: 'SELECT name, entity_type, embedding FROM entities WHERE name = ?',
		args: [name],
	});

	if (entityResult.rows.length === 0) {
		throw new Error(`Entity not found: ${name}`);
	}

	const observationsResult = await client.execute({
		sql: 'SELECT content FROM observations WHERE entity_name = ?',
		args: [name],
	});

	const embedding = includeEmbeddings && entityResult.rows[0].embedding
		? await extractVector(
				client,
				entityResult.rows[0].embedding as Uint8Array,
		  )
		: undefined;

	return {
		name: entityResult.rows[0].name as string,
		entityType: entityResult.rows[0].entity_type as string,
		observations: observationsResult.rows.map(
			(row: { content: string }) => row.content as string,
		),
		embedding,
	};
}

/**
 * Searches for entities by text query in name, type, or observations
 * @param client - Database client instance
 * @param query - Text query to search for
 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
 * @returns Array of matching entities
 */
export async function searchEntities(
	client: DatabaseClient,
	query: string,
	includeEmbeddings = false,
): Promise<Entity[]> {
	const results = await client.execute({
		sql: `
        SELECT DISTINCT e.name, e.entity_type, e.embedding
        FROM entities e
        LEFT JOIN observations o ON e.name = o.entity_name
        WHERE e.name LIKE ? OR e.entity_type LIKE ? OR o.content LIKE ?
      `,
		args: [`%${query}%`, `%${query}%`, `%${query}%`],
	});

	const entities: Entity[] = [];
	for (const row of results.rows) {
		const name = row.name as string;
		const observations = await client.execute({
			sql: 'SELECT content FROM observations WHERE entity_name = ?',
			args: [name],
		});

		const embedding = includeEmbeddings && row.embedding
			? await extractVector(client, row.embedding as Uint8Array)
			: undefined;

		entities.push({
			name,
			entityType: row.entity_type as string,
			observations: observations.rows.map(
				(obs: { content: string }) => obs.content as string,
			),
			embedding,
		});
	}

	return entities;
}

/**
 * Gets the most recently created entities
 * @param client - Database client instance
 * @param limit - Maximum number of entities to return
 * @param includeEmbeddings - Whether to include embeddings in the returned entities (default: false)
 * @returns Array of recent entities
 */
export async function getRecentEntities(
	client: DatabaseClient,
	limit = 10,
	includeEmbeddings = false,
): Promise<Entity[]> {
	const results = await client.execute({
		sql: 'SELECT name, entity_type, embedding FROM entities ORDER BY created_at DESC LIMIT ?',
		args: [limit],
	});

	const entities: Entity[] = [];
	for (const row of results.rows) {
		const name = row.name as string;
		const observations = await client.execute({
			sql: 'SELECT content FROM observations WHERE entity_name = ?',
			args: [name],
		});

		const embedding = includeEmbeddings && row.embedding
			? await extractVector(client, row.embedding as Uint8Array)
			: undefined;

		entities.push({
			name,
			entityType: row.entity_type as string,
			observations: observations.rows.map(
				(obs: { content: string }) => obs.content as string,
			),
			embedding,
		});
	}

	return entities;
}

/**
 * Deletes an entity and all its associated data
 * @param client - Database client instance
 * @param name - Name of the entity to delete
 */
export async function deleteEntity(
	client: DatabaseClient,
	name: string,
): Promise<void> {
	try {
		// Check if entity exists first
		const existing = await client.execute({
			sql: 'SELECT name FROM entities WHERE name = ?',
			args: [name],
		});

		if (existing.rows.length === 0) {
			throw new Error(`Entity not found: ${name}`);
		}

		// Prepare batch statements for deletion
		const batchStatements = [
			{
				// Delete associated observations first (due to foreign key)
				sql: 'DELETE FROM observations WHERE entity_name = ?',
				args: [name],
			},
			{
				// Delete associated relations (due to foreign key)
				sql: 'DELETE FROM relations WHERE source = ? OR target = ?',
				args: [name, name],
			},
			{
				// Delete the entity
				sql: 'DELETE FROM entities WHERE name = ?',
				args: [name],
			},
		];

		// Execute all deletions in a single batch transaction
		await client.batch(batchStatements, 'write');
	} catch (error) {
		throw new Error(
			`Failed to delete entity "${name}": ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}