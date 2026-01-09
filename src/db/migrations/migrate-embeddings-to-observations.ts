#!/usr/bin/env node
import { createClient } from '@libsql/client';
import { databaseConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { embeddingService, EMBEDDING_DIMENSION } from '../../services/embedding-service.js';
import { arrayToVectorString } from '../../services/vector-service.js';

/**
 * Migration script to move embeddings from entities to observations
 *
 * This migration:
 * 1. Removes the embedding column from the entities table
 * 2. Adds an embedding column to the observations table
 * 3. Generates embeddings for each observation
 *
 * NOTE: This migration uses createClient directly to handle databases
 * that may have different schemas.
 */
async function migrateEmbeddingsToObservations() {
    logger.info('Starting migration: Moving embeddings from entities to observations...');
    logger.info(`Using embedding dimension: ${EMBEDDING_DIMENSION}`);

    // Create database client directly (bypassing DatabaseService.initialize())
    const config = databaseConfig;
    logger.info(`Connecting to database: ${config.url}`);
    const client = createClient({
        url: config.url,
        authToken: config.authToken,
    });

    try {
        // Step 1: Disable foreign key constraints
        logger.info('Step 1: Disabling foreign key constraints...');
        await client.execute('PRAGMA foreign_keys = OFF');

        // Start a transaction for schema changes
        const txn = await client.transaction('write');

        try {
            // Step 2: Check current schema state
            logger.info('Step 2: Checking current schema state...');
            const entitiesInfo = await txn.execute("PRAGMA table_info(entities)");
            const observationsInfo = await txn.execute("PRAGMA table_info(observations)");

            const entitiesHasEmbedding = entitiesInfo.rows.some((row: any) => row.name === 'embedding');
            const observationsHasEmbedding = observationsInfo.rows.some((row: any) => row.name === 'embedding');

            logger.info(`Entities table has embedding column: ${entitiesHasEmbedding}`);
            logger.info(`Observations table has embedding column: ${observationsHasEmbedding}`);

            // Step 3: Create backup tables
            logger.info('Step 3: Creating backup tables...');
            await txn.execute('DROP TABLE IF EXISTS entities_backup');
            await txn.execute('DROP TABLE IF EXISTS observations_backup');
            await txn.execute('DROP TABLE IF EXISTS relations_backup');

            await txn.execute('CREATE TABLE entities_backup AS SELECT * FROM entities');
            await txn.execute('CREATE TABLE observations_backup AS SELECT * FROM observations');
            await txn.execute('CREATE TABLE relations_backup AS SELECT * FROM relations');

            // Step 4: Drop existing tables
            logger.info('Step 4: Dropping existing tables...');
            await txn.execute('DROP TABLE IF EXISTS observations');
            await txn.execute('DROP TABLE IF EXISTS relations');
            await txn.execute('DROP TABLE IF EXISTS entities');

            // Step 5: Create new entities table WITHOUT embedding
            logger.info('Step 5: Creating new entities table (without embedding)...');
            await txn.execute(`
                CREATE TABLE entities (
                    name TEXT PRIMARY KEY,
                    entity_type TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Step 6: Create new observations table WITH embedding
            logger.info('Step 6: Creating new observations table (with embedding)...');
            await txn.execute(`
                CREATE TABLE observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    embedding F32_BLOB(${EMBEDDING_DIMENSION}),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (entity_name) REFERENCES entities(name)
                )
            `);

            // Step 7: Create new relations table
            logger.info('Step 7: Creating new relations table...');
            await txn.execute(`
                CREATE TABLE relations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    target TEXT NOT NULL,
                    relation_type TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (source) REFERENCES entities(name),
                    FOREIGN KEY (target) REFERENCES entities(name)
                )
            `);

            // Step 8: Restore entities data (without embedding)
            logger.info('Step 8: Restoring entities data...');
            await txn.execute(`
                INSERT INTO entities (name, entity_type, created_at)
                SELECT name, entity_type, created_at FROM entities_backup
            `);

            // Step 9: Restore observations data (without embedding for now)
            logger.info('Step 9: Restoring observations data...');
            await txn.execute(`
                INSERT INTO observations (entity_name, content, created_at)
                SELECT entity_name, content, created_at FROM observations_backup
            `);

            // Step 10: Restore relations data
            logger.info('Step 10: Restoring relations data...');
            await txn.execute(`
                INSERT INTO relations (source, target, relation_type, created_at)
                SELECT source, target, relation_type, created_at FROM relations_backup
            `);

            // Step 11: Recreate indexes
            logger.info('Step 11: Recreating indexes...');
            await txn.execute('CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)');
            await txn.execute('CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name)');
            await txn.execute('CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source)');
            await txn.execute('CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target)');
            await txn.execute('CREATE INDEX IF NOT EXISTS idx_observations_embedding ON observations(libsql_vector_idx(embedding))');

            // Step 12: Drop backup tables
            logger.info('Step 12: Dropping backup tables...');
            await txn.execute('DROP TABLE entities_backup');
            await txn.execute('DROP TABLE observations_backup');
            await txn.execute('DROP TABLE relations_backup');

            // Commit transaction
            await txn.commit();
            logger.info('Schema migration completed successfully!');

        } catch (error) {
            await txn.rollback();
            throw error;
        }

        // Step 13: Re-enable foreign key constraints
        logger.info('Step 13: Re-enabling foreign key constraints...');
        await client.execute('PRAGMA foreign_keys = ON');

        // Step 14: Generate embeddings for observations
        logger.info('Step 14: Generating embeddings for observations...');
        const observations = await client.execute('SELECT id, content FROM observations WHERE embedding IS NULL');
        const totalObservations = observations.rows.length;
        logger.info(`Found ${totalObservations} observations needing embeddings`);

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < totalObservations; i++) {
            const row = observations.rows[i] as unknown as { id: number; content: string };
            const id = row.id;
            const content = row.content;

            try {
                const embedding = await embeddingService.generateEmbedding(content);
                const vectorString = arrayToVectorString(embedding);

                await client.execute({
                    sql: 'UPDATE observations SET embedding = vector32(?) WHERE id = ?',
                    args: [vectorString, id],
                });

                successCount++;
            } catch (error) {
                logger.error(`Failed to generate embedding for observation ${id}:`, error);
                errorCount++;
            }

            // Log progress every 10 observations
            if ((i + 1) % 10 === 0 || i === totalObservations - 1) {
                logger.info(`Progress: ${i + 1}/${totalObservations} observations (${successCount} success, ${errorCount} failed)`);
            }
        }

        logger.info(`Embedding generation complete: ${successCount} succeeded, ${errorCount} failed`);
        logger.info('Migration completed successfully!');

    } catch (error) {
        console.error('Migration failed with error:', error);
        if (error instanceof Error) {
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
        }
        throw new Error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        // Close database connection
        client.close();
    }
}

// Run migration
migrateEmbeddingsToObservations()
    .then(() => {
        logger.info('Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Migration failed:', error);
        process.exit(1);
    });
