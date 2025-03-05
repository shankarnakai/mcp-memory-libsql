#!/usr/bin/env node
import { DatabaseManager } from '../core.js';
import { databaseConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { EMBEDDING_DIMENSION } from '../../services/embedding-service.js';

/**
 * Migration script to update the database schema to support larger vector dimensions
 * This script will:
 * 1. Create a backup of the entities table
 * 2. Drop the existing entities table
 * 3. Create a new entities table with the updated vector dimension
 * 4. Restore the data from the backup table
 * 5. Drop the backup table
 */
async function migrateVectorDimension() {
    logger.info('Starting vector dimension migration...');
    
    // Get database connection
    const config = databaseConfig;
    const dbManager = await DatabaseManager.getInstance(config);
    const client = dbManager.getClient();
    
    try {
        // Start transaction
        const txn = await client.transaction('write');
        
        try {
            // 1. Check if backup table exists and drop it if it does
            logger.info('Checking for existing backup table...');
            await txn.execute({
                sql: `DROP TABLE IF EXISTS entities_backup`
            });
            
            // 2. Create backup of entities table
            logger.info('Creating backup of entities table...');
            await txn.execute({
                sql: `CREATE TABLE entities_backup AS SELECT * FROM entities`
            });
            
            // 3. Drop existing entities table
            logger.info('Dropping existing entities table...');
            await txn.execute({
                sql: `DROP TABLE entities`
            });
            
            // 4. Create new entities table with updated vector dimension
            logger.info(`Creating new entities table with ${EMBEDDING_DIMENSION} dimensions...`);
            await txn.execute({
                sql: `
                    CREATE TABLE entities (
                        name TEXT PRIMARY KEY,
                        entity_type TEXT NOT NULL,
                        embedding F32_BLOB(${EMBEDDING_DIMENSION}), -- Updated dimension
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `
            });
            
            // 5. Restore data from backup (excluding embeddings as they're incompatible)
            logger.info('Restoring data from backup (without embeddings)...');
            await txn.execute({
                sql: `
                    INSERT INTO entities (name, entity_type, created_at)
                    SELECT name, entity_type, created_at FROM entities_backup
                `
            });
            
            // 6. Recreate index
            logger.info('Recreating vector index...');
            await txn.execute({
                sql: 'CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities(libsql_vector_idx(embedding))'
            });
            
            // 7. Drop backup table
            logger.info('Dropping backup table...');
            await txn.execute({
                sql: `DROP TABLE entities_backup`
            });
            
            // Commit transaction
            await txn.commit();
            logger.info('Vector dimension migration completed successfully!');
            
        } catch (error) {
            // Rollback transaction on error
            await txn.rollback();
            throw error;
        }
    } catch (error) {
        logger.error('Migration failed:', error);
        throw new Error(`Vector dimension migration failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        // Close database connection
        await dbManager.close();
    }
}

// Run migration
migrateVectorDimension()
    .then(() => {
        logger.info('Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Migration failed:', error);
        process.exit(1);
    });