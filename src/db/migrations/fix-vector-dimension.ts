#!/usr/bin/env node
import { DatabaseManager } from '../core.js';
import { databaseConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { EMBEDDING_DIMENSION } from '../../services/embedding-service.js';

/**
 * Migration script to fix the database schema to support the correct vector dimensions
 * This script will:
 * 1. Disable foreign key constraints
 * 2. Create backups of all tables (entities, observations, relations)
 * 3. Drop the existing tables in the correct order
 * 4. Create new tables with the updated vector dimension
 * 5. Restore the data from the backup tables (excluding incompatible embeddings)
 * 6. Re-enable foreign key constraints
 */
async function fixVectorDimension() {
    logger.info('Starting vector dimension fix...');
    
    // Get database connection
    const config = databaseConfig;
    const dbManager = await DatabaseManager.getInstance(config);
    const client = dbManager.getClient();
    
    try {
        // Start transaction
        const txn = await client.transaction('write');
        
        try {
            // 1. Disable foreign key constraints
            logger.info('Disabling foreign key constraints...');
            await txn.execute({
                sql: `PRAGMA foreign_keys = OFF;`
            });
            
            // 2. Check if backup tables exist and drop them if they do
            logger.info('Checking for existing backup tables...');
            await txn.execute({
                sql: `DROP TABLE IF EXISTS entities_backup`
            });
            await txn.execute({
                sql: `DROP TABLE IF EXISTS observations_backup`
            });
            await txn.execute({
                sql: `DROP TABLE IF EXISTS relations_backup`
            });
            
            // 3. Create backups of all tables
            logger.info('Creating backup of entities table...');
            await txn.execute({
                sql: `CREATE TABLE entities_backup AS SELECT * FROM entities`
            });
            
            logger.info('Creating backup of observations table...');
            await txn.execute({
                sql: `CREATE TABLE observations_backup AS SELECT * FROM observations`
            });
            
            logger.info('Creating backup of relations table...');
            await txn.execute({
                sql: `CREATE TABLE relations_backup AS SELECT * FROM relations`
            });
            
            // 4. Drop existing tables in the correct order (respecting foreign key relationships)
            logger.info('Dropping existing tables...');
            await txn.execute({
                sql: `DROP TABLE IF EXISTS observations`
            });
            await txn.execute({
                sql: `DROP TABLE IF EXISTS relations`
            });
            await txn.execute({
                sql: `DROP TABLE IF EXISTS entities`
            });
            
            // 5. Create new tables with updated vector dimension
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
            
            logger.info('Creating new observations table...');
            await txn.execute({
                sql: `
                    CREATE TABLE observations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        entity_name TEXT NOT NULL,
                        content TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (entity_name) REFERENCES entities(name)
                    )
                `
            });
            
            logger.info('Creating new relations table...');
            await txn.execute({
                sql: `
                    CREATE TABLE relations (
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
            
            // 6. Restore data from backups (excluding embeddings as they're incompatible)
            logger.info('Restoring entities data from backup (without embeddings)...');
            await txn.execute({
                sql: `
                    INSERT INTO entities (name, entity_type, created_at)
                    SELECT name, entity_type, created_at FROM entities_backup
                `
            });
            
            logger.info('Restoring observations data from backup...');
            await txn.execute({
                sql: `
                    INSERT INTO observations (entity_name, content, created_at)
                    SELECT entity_name, content, created_at FROM observations_backup
                `
            });
            
            logger.info('Restoring relations data from backup...');
            await txn.execute({
                sql: `
                    INSERT INTO relations (source, target, relation_type, created_at)
                    SELECT source, target, relation_type, created_at FROM relations_backup
                `
            });
            
            // 7. Recreate indexes
            logger.info('Recreating indexes...');
            await txn.execute({
                sql: 'CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)'
            });
            await txn.execute({
                sql: 'CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name)'
            });
            await txn.execute({
                sql: 'CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source)'
            });
            await txn.execute({
                sql: 'CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target)'
            });
            await txn.execute({
                sql: 'CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities(libsql_vector_idx(embedding))'
            });
            
            // 8. Re-enable foreign key constraints
            logger.info('Re-enabling foreign key constraints...');
            await txn.execute({
                sql: `PRAGMA foreign_keys = ON;`
            });
            
            // 9. Drop backup tables
            logger.info('Dropping backup tables...');
            await txn.execute({
                sql: `DROP TABLE entities_backup`
            });
            await txn.execute({
                sql: `DROP TABLE observations_backup`
            });
            await txn.execute({
                sql: `DROP TABLE relations_backup`
            });
            
            // Commit transaction
            await txn.commit();
            logger.info('Vector dimension fix completed successfully!');
            
        } catch (error) {
            // Rollback transaction on error
            await txn.rollback();
            throw error;
        }
    } catch (error) {
        logger.error('Migration failed:', error);
        throw new Error(`Vector dimension fix failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        // Close database connection
        await dbManager.close();
    }
}

// Run migration
fixVectorDimension()
    .then(() => {
        logger.info('Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Migration failed:', error);
        process.exit(1);
    });