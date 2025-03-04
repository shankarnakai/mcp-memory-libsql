#!/usr/bin/env node
import { DatabaseManager } from './index.js';
import { get_database_config } from './config.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding } from './embedding-service.js';

/**
 * Test script to verify the embedding functionality
 */
async function testEmbeddings() {
    logger.info('Starting embedding test...');
    
    // Get database connection
    const config = get_database_config();
    const dbManager = await DatabaseManager.get_instance(config);
    
    try {
        // Test 1: Generate an embedding
        logger.info('Test 1: Generating embedding for test text...');
        const testText = "This is a test of the embedding functionality";
        const embedding = await generateEmbedding(testText);
        logger.info(`Successfully generated embedding with dimension: ${embedding.length}`);
        
        // Test 2: Create an entity with automatic embedding
        logger.info('Test 2: Creating entity with automatic embedding...');
        await dbManager.create_entities([
            {
                name: "TestEntityAuto",
                entityType: "test",
                observations: ["This is a test entity with automatic embedding generation"]
            }
        ]);
        logger.info('Successfully created entity with automatic embedding');
        
        // Test 3: Create an entity with explicit embedding
        logger.info('Test 3: Creating entity with explicit embedding...');
        await dbManager.create_entities([
            {
                name: "TestEntityExplicit",
                entityType: "test",
                observations: ["This is a test entity with explicit embedding"],
                embedding: embedding
            }
        ]);
        logger.info('Successfully created entity with explicit embedding');
        
        // Test 4: Search for entities using text query
        logger.info('Test 4: Searching for entities using text query...');
        const textSearchResults = await dbManager.search_nodes("test entity");
        logger.info(`Text search found ${textSearchResults.entities.length} entities`);
        
        // Test 5: Search for entities using vector query
        logger.info('Test 5: Searching for entities using vector query...');
        const vectorSearchResults = await dbManager.search_nodes(embedding);
        logger.info(`Vector search found ${vectorSearchResults.entities.length} entities`);
        
        // Test 6: Retrieve and verify entity embeddings
        logger.info('Test 6: Retrieving and verifying entity embeddings...');
        const entity1 = await dbManager.get_entity("TestEntityAuto");
        const entity2 = await dbManager.get_entity("TestEntityExplicit");
        
        logger.info(`TestEntityAuto embedding dimension: ${entity1.embedding?.length || 'undefined'}`);
        logger.info(`TestEntityExplicit embedding dimension: ${entity2.embedding?.length || 'undefined'}`);
        
        // Test 7: Clean up test entities
        logger.info('Test 7: Cleaning up test entities...');
        await dbManager.delete_entity("TestEntityAuto");
        await dbManager.delete_entity("TestEntityExplicit");
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