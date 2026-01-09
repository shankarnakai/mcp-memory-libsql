#!/usr/bin/env node
/**
 * Migration script to update the database schema to support larger vector dimensions
 * This script will:
 * 1. Create a backup of the entities table
 * 2. Drop the existing entities table
 * 3. Create a new entities table with the updated vector dimension
 * 4. Restore the data from the backup table
 * 5. Drop the backup table
 *
 * Usage: npm run migrate:vector-dimension
 */
import { createClient } from '@libsql/client';
import { databaseConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { EMBEDDING_DIMENSION } from '../../services/embedding-service.js';

async function migrateVectorDimension() {
    logger.info('Starting vector dimension migration...');

    // Create database client directly (bypassing DatabaseManager.initialize())
    const config = databaseConfig;
    logger.info(`Connecting to database: ${config.url}`);
    const client = createClient({
        url: config.url,
        authToken: config.authToken,
    });

    try {
        // Disable foreign keys BEFORE transaction (PRAGMA doesn't work inside transactions)
        logger.info('Disabling foreign key constraints...');
        await client.execute('PRAGMA foreign_keys = OFF');

        // Start transaction
        const txn = await client.transaction('write');

        try {
            // 1. Check if backup table exists and drop it if it does
            logger.info('Checking for existing backup table...');
            await txn.execute(`DROP TABLE IF EXISTS entities_backup`);

            // 2. Create backup of entities table
            logger.info('Creating backup of entities table...');
            await txn.execute(`CREATE TABLE entities_backup AS SELECT * FROM entities`);

            // 3. Drop existing entities table
            logger.info('Dropping existing entities table...');
            await txn.execute(`DROP TABLE entities`);

            // 4. Create new entities table with updated vector dimension
            logger.info(`Creating new entities table with ${EMBEDDING_DIMENSION} dimensions...`);
            await txn.execute(`
                CREATE TABLE entities (
                    name TEXT PRIMARY KEY,
                    entity_type TEXT NOT NULL,
                    embedding F32_BLOB(${EMBEDDING_DIMENSION}),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 5. Restore data from backup (excluding embeddings as they're incompatible)
            logger.info('Restoring data from backup (without embeddings)...');
            await txn.execute(`
                INSERT INTO entities (name, entity_type, created_at)
                SELECT name, entity_type, created_at FROM entities_backup
            `);

            // 6. Recreate index
            logger.info('Recreating vector index...');
            await txn.execute(`CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities(libsql_vector_idx(embedding))`);

            // 7. Drop backup table
            logger.info('Dropping backup table...');
            await txn.execute(`DROP TABLE entities_backup`);

            // Commit transaction
            await txn.commit();
            logger.info('Vector dimension migration completed successfully!');

        } catch (error) {
            // Rollback transaction on error
            await txn.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Migration failed with error:', error);
        if (error instanceof Error) {
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
        }
        throw new Error(`Vector dimension migration failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        // Re-enable foreign keys
        logger.info('Re-enabling foreign key constraints...');
        await client.execute('PRAGMA foreign_keys = ON');
        // Close database connection
        client.close();
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
