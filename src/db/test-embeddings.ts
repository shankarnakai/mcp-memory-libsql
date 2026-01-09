#!/usr/bin/env node
import { DatabaseManager } from './index.js';
import { databaseConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { embeddingService } from '../services/embedding-service.js';

/**
 * Test script to verify the embedding functionality
 * Embeddings are now auto-generated per observation
 */
async function testEmbeddings() {
    logger.info('Starting embedding test...');

    // Get database connection
    const config = databaseConfig;
    const dbManager = await DatabaseManager.get_instance(config);

    try {
        // Test 1: Generate an embedding manually
        logger.info('Test 1: Generating embedding for test text...');
        const testText = "This is a test of the embedding functionality";
        const embedding = await embeddingService.generateEmbedding(testText);
        logger.info(`Successfully generated embedding with dimension: ${embedding.length}`);

        // Test 2: Create an entity - embeddings are auto-generated per observation
        logger.info('Test 2: Creating entity (embeddings auto-generated per observation)...');
        await dbManager.create_entities([
            {
                name: "TestEntityAuto",
                entityType: "test",
                observations: ["This is a test entity with automatic embedding generation"]
            }
        ]);
        logger.info('Successfully created entity with auto-generated observation embeddings');

        // Test 3: Create another entity with multiple observations
        logger.info('Test 3: Creating entity with multiple observations...');
        await dbManager.create_entities([
            {
                name: "TestEntityMultiple",
                entityType: "test",
                observations: [
                    "First observation for testing",
                    "Second observation about embeddings",
                    "Third observation for vector search"
                ]
            }
        ]);
        logger.info('Successfully created entity with multiple observations');

        // Test 4: Search for entities using text query
        logger.info('Test 4: Searching for entities using text query...');
        const textSearchResults = await dbManager.search_nodes("test entity");
        logger.info(`Text search found ${textSearchResults.entities.length} entities`);

        // Test 5: Search for entities using vector query
        logger.info('Test 5: Searching for entities using vector query...');
        const vectorSearchResults = await dbManager.search_nodes(embedding);
        logger.info(`Vector search found ${vectorSearchResults.entities.length} entities`);

        // Test 6: Retrieve entity and verify observations
        logger.info('Test 6: Retrieving and verifying entities...');
        const entity1 = await dbManager.get_entity("TestEntityAuto");
        const entity2 = await dbManager.get_entity("TestEntityMultiple");

        logger.info(`TestEntityAuto observations: ${entity1.observations.length}`);
        logger.info(`TestEntityMultiple observations: ${entity2.observations.length}`);

        // Test 7: Clean up test entities
        logger.info('Test 7: Cleaning up test entities...');
        await dbManager.delete_entity("TestEntityAuto");
        await dbManager.delete_entity("TestEntityMultiple");
        logger.info('Successfully deleted test entities');

        logger.info('All embedding tests completed successfully!');
    } catch (error) {
        logger.error('Embedding test failed:', error);
        throw error;
    } finally {
        // Close database connection
        await dbManager.close();
    }
}

// Run tests
testEmbeddings()
    .then(() => {
        logger.info('Embedding tests completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Embedding tests failed:', error);
        process.exit(1);
    });
