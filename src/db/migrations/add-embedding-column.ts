#!/usr/bin/env node
/**
 * Migration script to add the embedding column to an existing database
 * that was created without it.
 *
 * Usage: node --loader ts-node/esm src/db/migrations/add-embedding-column.ts
 *
 * Set LIBSQL_URL environment variable or it will use the default from config.
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

// Load environment variables
config();

const LIBSQL_URL = process.env.LIBSQL_URL || 'file:memory.db';
const LIBSQL_AUTH_TOKEN = process.env.LIBSQL_AUTH_TOKEN;
const EMBEDDING_DIMENSION = 384;

async function addEmbeddingColumn() {
    console.log('Starting migration to add embedding column...');
    console.log(`Database URL: ${LIBSQL_URL}`);
    console.log(`Embedding dimension: ${EMBEDDING_DIMENSION}`);

    const client = createClient({
        url: LIBSQL_URL,
        authToken: LIBSQL_AUTH_TOKEN,
    });

    try {
        // Check current schema
        console.log('\nChecking current schema...');
        const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
        console.log('Existing tables:', tables.rows.map(r => r.name).join(', '));

        // Check if entities table exists
        const entitiesExists = tables.rows.some(r => r.name === 'entities');
        if (!entitiesExists) {
            console.log('\nNo entities table found. Creating fresh schema...');
            await createFreshSchema(client);
            return;
        }

        // Check if embedding column already exists
        const columns = await client.execute(`PRAGMA table_info(entities)`);
        const hasEmbedding = columns.rows.some(r => r.name === 'embedding');

        if (hasEmbedding) {
            console.log('\nEmbedding column already exists. Checking if dimension needs update...');
            // Could add dimension check here if needed
            console.log('Migration not needed - embedding column already exists.');
            return;
        }

        console.log('\nEmbedding column not found. Migrating schema...');
        await migrateSchema(client);

        console.log('\nMigration completed successfully!');
        console.log('Note: Existing entities will need their embeddings regenerated.');
        console.log('Run: npm run regenerate:embeddings');

    } catch (error) {
        console.error('\nMigration failed:', error);
        if (error instanceof Error) {
            console.error('Message:', error.message);
            console.error('Stack:', error.stack);
        }
        process.exit(1);
    } finally {
        client.close();
    }
}

async function createFreshSchema(client: ReturnType<typeof createClient>) {
    console.log('Creating entities table...');
    await client.execute(`
        CREATE TABLE entities (
            name TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            embedding F32_BLOB(${EMBEDDING_DIMENSION}),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('Creating observations table...');
    await client.execute(`
        CREATE TABLE IF NOT EXISTS observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (entity_name) REFERENCES entities(name)
        )
    `);

    console.log('Creating relations table...');
    await client.execute(`
        CREATE TABLE IF NOT EXISTS relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source) REFERENCES entities(name),
            FOREIGN KEY (target) REFERENCES entities(name)
        )
    `);

    console.log('Creating indexes...');
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities(libsql_vector_idx(embedding))`);

    console.log('Fresh schema created successfully!');
}

async function migrateSchema(client: ReturnType<typeof createClient>) {
    // Disable foreign keys BEFORE starting transaction (PRAGMA doesn't work inside transactions)
    console.log('Disabling foreign key constraints...');
    await client.execute(`PRAGMA foreign_keys = OFF`);

    // Use a transaction for the migration
    const txn = await client.transaction('write');

    try {

        // 2. Create backup tables
        console.log('Creating backup of entities table...');
        await txn.execute(`DROP TABLE IF EXISTS entities_backup`);
        await txn.execute(`CREATE TABLE entities_backup AS SELECT * FROM entities`);

        // 3. Drop original entities table
        console.log('Dropping original entities table...');
        await txn.execute(`DROP TABLE entities`);

        // 4. Create new entities table with embedding column
        console.log(`Creating new entities table with embedding column (${EMBEDDING_DIMENSION} dimensions)...`);
        await txn.execute(`
            CREATE TABLE entities (
                name TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                embedding F32_BLOB(${EMBEDDING_DIMENSION}),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 5. Restore data from backup
        console.log('Restoring data from backup...');
        await txn.execute(`
            INSERT INTO entities (name, entity_type, created_at)
            SELECT name, entity_type, created_at FROM entities_backup
        `);

        // 6. Create vector index
        console.log('Creating vector index...');
        await txn.execute(`CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities(libsql_vector_idx(embedding))`);

        // 7. Drop backup table
        console.log('Dropping backup table...');
        await txn.execute(`DROP TABLE entities_backup`);

        // Commit
        await txn.commit();
        console.log('Schema migration completed!');

    } catch (error) {
        console.error('Error during migration, rolling back...');
        await txn.rollback();
        throw error;
    } finally {
        // Re-enable foreign keys (outside transaction)
        console.log('Re-enabling foreign key constraints...');
        await client.execute(`PRAGMA foreign_keys = ON`);
    }
}

// Run migration
addEmbeddingColumn()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
