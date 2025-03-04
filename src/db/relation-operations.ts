import { Relation } from '../types/index.js';
import { DatabaseClient, RelationCreateParams } from './types.js';

/**
 * Creates relations between entities
 * @param client - Database client instance
 * @param relations - Array of relations to create
 */
export async function createRelations(
	client: DatabaseClient,
	relations: RelationCreateParams[],
): Promise<void> {
	try {
		if (relations.length === 0) return;

		// Prepare batch statements for all relations
		const batchStatements = relations.map((relation) => ({
			sql: 'INSERT INTO relations (source, target, relation_type) VALUES (?, ?, ?)',
			args: [relation.from, relation.to, relation.relationType],
		}));

		// Execute all inserts in a single batch transaction
		await client.batch(batchStatements, 'write');
	} catch (error) {
		throw new Error(
			`Failed to create relations: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Deletes a specific relation between entities
 * @param client - Database client instance
 * @param source - Source entity name
 * @param target - Target entity name
 * @param type - Relation type
 */
export async function deleteRelation(
	client: DatabaseClient,
	source: string,
	target: string,
	type: string,
): Promise<void> {
	try {
		const result = await client.execute({
			sql: 'DELETE FROM relations WHERE source = ? AND target = ? AND relation_type = ?',
			args: [source, target, type],
		});

		if (result.rowsAffected === 0) {
			throw new Error(
				`Relation not found: ${source} -> ${target} (${type})`,
			);
		}
	} catch (error) {
		throw new Error(
			`Failed to delete relation: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Gets relations for a set of entities
 * @param client - Database client instance
 * @param entities - Array of entities to get relations for
 * @returns Array of relations
 */
export async function getRelationsForEntities(
	client: DatabaseClient,
	entityNames: string[],
): Promise<Relation[]> {
	if (entityNames.length === 0) return [];

	const placeholders = entityNames.map(() => '?').join(',');

	const results = await client.execute({
		sql: `
        SELECT source as from_entity, target as to_entity, relation_type 
        FROM relations 
        WHERE source IN (${placeholders}) 
        OR target IN (${placeholders})
      `,
		args: [...entityNames, ...entityNames],
	});

	return results.rows.map((row: { from_entity: string; to_entity: string; relation_type: string }) => ({
		from: row.from_entity as string,
		to: row.to_entity as string,
		relationType: row.relation_type as string,
	}));
}