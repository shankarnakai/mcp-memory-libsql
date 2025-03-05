import { databaseService } from './database-service.js';
import { logger } from '../utils/logger.js';
import { DatabaseError, ValidationError, parseDatabaseError } from '../utils/errors.js';
import { Relation } from '../models/index.js';

/**
 * Relation service for managing relations between entities
 */
export class RelationService {
  /**
   * Creates relations between entities
   * @param relations - Array of relations to create
   * @returns Promise resolving when all relations are created
   */
  public static async createRelations(
    relations: Array<{ from: string; to: string; relationType: string }>
  ): Promise<void> {
    try {
      if (!relations || !Array.isArray(relations) || relations.length === 0) {
        return;
      }

      // Validate relations
      for (const relation of relations) {
        if (!relation.from || typeof relation.from !== 'string') {
          throw new ValidationError('Relation source must be a non-empty string');
        }
        
        if (!relation.to || typeof relation.to !== 'string') {
          throw new ValidationError('Relation target must be a non-empty string');
        }
        
        if (!relation.relationType || typeof relation.relationType !== 'string') {
          throw new ValidationError('Relation type must be a non-empty string');
        }
      }

      const client = databaseService.getClient();
      
      // Prepare batch statements for all relations
      const batchStatements = relations.map((relation) => ({
        sql: 'INSERT INTO relations (source, target, relation_type) VALUES (?, ?, ?)',
        args: [relation.from, relation.to, relation.relationType],
      }));

      // Execute all inserts in a single batch transaction
      await client.batch(batchStatements, 'write');
      
      logger.info(`Created ${relations.length} relations`);
    } catch (error) {
      // Parse database errors
      if (error instanceof Error && error.message.includes('SQLITE_CONSTRAINT')) {
        throw parseDatabaseError(error);
      }
      
      throw new DatabaseError(
        `Failed to create relations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Deletes a specific relation between entities
   * @param source - Source entity name
   * @param target - Target entity name
   * @param type - Relation type
   * @returns Promise resolving when the relation is deleted
   */
  public static async deleteRelation(
    source: string,
    target: string,
    type: string,
  ): Promise<void> {
    try {
      // Validate parameters
      if (!source || typeof source !== 'string') {
        throw new ValidationError('Source entity name must be a non-empty string');
      }
      
      if (!target || typeof target !== 'string') {
        throw new ValidationError('Target entity name must be a non-empty string');
      }
      
      if (!type || typeof type !== 'string') {
        throw new ValidationError('Relation type must be a non-empty string');
      }

      const client = databaseService.getClient();
      
      const result = await client.execute({
        sql: 'DELETE FROM relations WHERE source = ? AND target = ? AND relation_type = ?',
        args: [source, target, type],
      });

      if (result.rowsAffected === 0) {
        throw new ValidationError(
          `Relation not found: ${source} -> ${target} (${type})`,
        );
      }
      
      logger.info(`Deleted relation: ${source} -> ${target} (${type})`);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new DatabaseError(
        `Failed to delete relation: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Gets relations for a set of entities
   * @param entityNames - Array of entity names to get relations for
   * @returns Promise resolving to an array of relations
   */
  public static async getRelationsForEntities(
    entityNames: string[],
  ): Promise<Relation[]> {
    try {
      if (!entityNames || !Array.isArray(entityNames) || entityNames.length === 0) {
        return [];
      }

      const client = databaseService.getClient();
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
    } catch (error) {
      throw new DatabaseError(
        `Failed to get relations for entities: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

// Export convenience functions
export const createRelations = RelationService.createRelations;
export const deleteRelation = RelationService.deleteRelation;
export const getRelationsForEntities = RelationService.getRelationsForEntities;