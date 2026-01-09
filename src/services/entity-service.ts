import { databaseService } from './database-service.js';
import { embeddingService } from './embedding-service.js';
import { arrayToVectorString } from './vector-service.js';
import { logger } from '../utils/logger.js';
import { DatabaseError, ValidationError, parseDatabaseError } from '../utils/errors.js';
import { Entity, EntityCreateParams } from '../models/index.js';

/**
 * Entity service for managing entities in the database
 */
export class EntityService {
  /**
   * Creates or updates entities with observations and optional embeddings
   * @param entities - Array of entities to create or update
   */
  public static async createEntities(entities: EntityCreateParams[]): Promise<void> {
    try {
      const client = databaseService.getClient();
      
      for (const entity of entities) {
        // Validate entity
        if (!entity.name || typeof entity.name !== 'string' || entity.name.trim() === '') {
          throw new ValidationError('Entity name must be a non-empty string');
        }

        if (!entity.entityType || typeof entity.entityType !== 'string' || entity.entityType.trim() === '') {
          throw new ValidationError(`Invalid entity type for entity "${entity.name}"`);
        }

        if (!Array.isArray(entity.observations) || entity.observations.length === 0) {
          throw new ValidationError(`Entity "${entity.name}" must have at least one observation`);
        }

        // Use a transaction for entity and observations
        await databaseService.transaction(async (txn) => {
          // First try to update entity (no embedding on entity anymore)
          const result = await txn.execute({
            sql: 'UPDATE entities SET entity_type = ? WHERE name = ?',
            args: [entity.entityType, entity.name],
          });

          // If no rows affected, do insert
          if (result.rowsAffected === 0) {
            await txn.execute({
              sql: 'INSERT INTO entities (name, entity_type) VALUES (?, ?)',
              args: [entity.name, entity.entityType],
            });
          }

          // Clear old observations
          await txn.execute({
            sql: 'DELETE FROM observations WHERE entity_name = ?',
            args: [entity.name],
          });

          // Add new observations with per-observation embeddings
          for (const observation of entity.observations) {
            let embedding: number[] | undefined;

            try {
              logger.info(`Generating embedding for observation: "${observation.substring(0, 50)}..."`);
              embedding = await embeddingService.generateEmbedding(observation);
            } catch (error) {
              logger.error(`Failed to generate embedding for observation:`, error);
            }

            const vectorString = embedding ? arrayToVectorString(embedding) : null;

            await txn.execute({
              sql: 'INSERT INTO observations (entity_name, content, embedding) VALUES (?, ?, vector32(?))',
              args: [entity.name, observation, vectorString],
            });
          }
        });

        // Handle relations if provided
        if (entity.relations && entity.relations.length > 0) {
          const relations = entity.relations.map(rel => ({
            from: entity.name,
            to: rel.target,
            relationType: rel.relationType
          }));
          
          await EntityService.createRelations(relations);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('SQLITE_CONSTRAINT')) {
        throw parseDatabaseError(error);
      }
      
      throw new DatabaseError(
        `Entity operation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Creates relations between entities
   * @param relations - Array of relations to create
   */
  public static async createRelations(
    relations: Array<{ from: string; to: string; relationType: string }>
  ): Promise<void> {
    try {
      if (relations.length === 0) return;

      const client = databaseService.getClient();
      
      const batchStatements = relations.map((relation) => ({
        sql: 'INSERT INTO relations (source, target, relation_type) VALUES (?, ?, ?)',
        args: [relation.from, relation.to, relation.relationType],
      }));

      await client.batch(batchStatements, 'write');
    } catch (error) {
      throw new DatabaseError(
        `Failed to create relations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Gets an entity by name
   * @param name - Name of the entity to retrieve
   */
  public static async getEntity(name: string): Promise<Entity> {
    const client = databaseService.getClient();

    const entityResult = await client.execute({
      sql: 'SELECT name, entity_type FROM entities WHERE name = ?',
      args: [name],
    });

    if (entityResult.rows.length === 0) {
      throw new ValidationError(`Entity not found: ${name}`);
    }

    const observationsResult = await client.execute({
      sql: 'SELECT content FROM observations WHERE entity_name = ?',
      args: [name],
    });

    return {
      name: entityResult.rows[0].name as string,
      entityType: entityResult.rows[0].entity_type as string,
      observations: observationsResult.rows.map(
        (row: { content: string }) => row.content as string,
      ),
    };
  }

  /**
   * Gets recent entities
   * @param limit - Maximum number of entities to retrieve
   */
  public static async getRecentEntities(limit = 10): Promise<Entity[]> {
    try {
      const client = databaseService.getClient();

      const entityResults = await client.execute({
        sql: 'SELECT name, entity_type FROM entities ORDER BY rowid DESC LIMIT ?',
        args: [limit],
      });

      if (entityResults.rows.length === 0) {
        return [];
      }

      const entities: Entity[] = [];

      for (const row of entityResults.rows) {
        const name = row.name as string;

        const observationsResult = await client.execute({
          sql: 'SELECT content FROM observations WHERE entity_name = ?',
          args: [name],
        });

        entities.push({
          name,
          entityType: row.entity_type as string,
          observations: observationsResult.rows.map(
            (obsRow: { content: string }) => obsRow.content as string,
          ),
        });
      }

      return entities;
    } catch (error) {
      throw new DatabaseError(
        `Failed to get recent entities: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Deletes an entity and all its associated data
   * @param name - Name of the entity to delete
   */
  public static async deleteEntity(name: string): Promise<void> {
    try {
      const client = databaseService.getClient();
      
      // Check if entity exists first
      const existing = await client.execute({
        sql: 'SELECT name FROM entities WHERE name = ?',
        args: [name],
      });

      if (existing.rows.length === 0) {
        throw new ValidationError(`Entity not found: ${name}`);
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
      throw new DatabaseError(
        `Failed to delete entity "${name}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

// Export convenience functions
export const createEntities = EntityService.createEntities;
export const createRelations = EntityService.createRelations;
export const getEntity = EntityService.getEntity;
export const deleteEntity = EntityService.deleteEntity;
export const getRecentEntities = EntityService.getRecentEntities;
