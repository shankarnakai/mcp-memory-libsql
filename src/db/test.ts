/**
 * Test script for the refactored database operations
 *
 * This script tests all operations in the refactored modules:
 * - Core database operations
 * - Entity operations
 * - Relation operations
 * - Graph operations
 * - Vector utilities
 *
 * It also verifies backward compatibility with the snake_case interface provided by index.js.
 */

import { DatabaseManager as CoreDatabaseManager } from './core.js';
import { DatabaseManager as LegacyDatabaseManager } from './index.js';
import {
  createEntities,
  searchSimilar,
  getEntity,
  searchEntities,
  getRecentEntities,
  deleteEntity
} from './index.js';
import {
  createRelations,
  deleteRelation,
  getRelationsForEntities
} from './index.js';
import {
  readGraph,
  searchNodes
} from './index.js';
import { arrayToVectorString, extractVector } from './index.js';
import { DatabaseConfig } from './types.js';
import { EMBEDDING_DIMENSION } from '../services/embedding-service.js';

// Test configuration
const config: DatabaseConfig = {
  url: 'file:memory-test.db',
};

// Test data
// Helper function to generate a test embedding vector of the correct dimension
function generateTestEmbedding(seed: number): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    // Generate a value between 0 and 1 based on the seed and position
    embedding.push((seed * 0.1 + i * 0.001) % 1);
  }
  return embedding;
}

const testEntities = [
  {
    name: 'TestEntity1',
    entityType: 'test',
    observations: ['Test observation 1', 'Test observation 2'],
    embedding: generateTestEmbedding(1),
  },
  {
    name: 'TestEntity2',
    entityType: 'test',
    observations: ['Test observation 3', 'Test observation 4'],
    embedding: generateTestEmbedding(5),
  },
  {
    name: 'TestEntity3',
    entityType: 'test',
    observations: ['Test observation 5', 'Test observation 6'],
    embedding: generateTestEmbedding(9),
  },
];

const testRelations = [
  {
    from: 'TestEntity1',
    to: 'TestEntity2',
    relationType: 'test_relation',
  },
  {
    from: 'TestEntity2',
    to: 'TestEntity3',
    relationType: 'test_relation',
  },
  {
    from: 'TestEntity3',
    to: 'TestEntity1',
    relationType: 'test_relation',
  },
];

/**
 * Run tests for the refactored modules
 */
async function runTests() {
  console.log('Starting database operations tests...');
  
  try {
    // Test core database operations
    console.log('\n--- Testing Core Database Operations ---');
    const coreManager = await CoreDatabaseManager.getInstance(config);
    const client = coreManager.getClient();
    
    // Explicitly initialize the database to ensure tables are created
    await coreManager.initialize();
    
    // Initialize the DatabaseService singleton that's used by entity operations
    const { databaseService } = await import('../services/database-service.js');
    await databaseService.initialize();
    
    console.log('✓ Core database initialization successful');
    
    // Test entity operations
    console.log('\n--- Testing Entity Operations ---');
    await createEntities(testEntities);
    console.log('✓ Entity creation successful');
    
    const entity = await getEntity('TestEntity1');
    console.log(`✓ Entity retrieval successful: ${entity.name}`);
    
    const similarityTestVector = generateTestEmbedding(1); // Use the same vector as TestEntity1
    const similarEntities = await searchSimilar(client, similarityTestVector);
    console.log(`✓ Similar entity search successful: ${similarEntities.length} entities found`);
    
    const searchedEntities = await searchEntities(client, 'Test');
    console.log(`✓ Entity text search successful: ${searchedEntities.length} entities found`);
    
    const recentEntities = await getRecentEntities(10);
    console.log(`✓ Recent entities retrieval successful: ${recentEntities.length} entities found`);
    
    // Test relation operations
    console.log('\n--- Testing Relation Operations ---');
    await createRelations(testRelations);
    console.log('✓ Relation creation successful');
    
    const entityNames = testEntities.map(e => e.name);
    const relations = await getRelationsForEntities(entityNames);
    console.log(`✓ Relations retrieval successful: ${relations.length} relations found`);
    
    // Test graph operations
    console.log('\n--- Testing Graph Operations ---');
    const graph = await readGraph();
    console.log(`✓ Graph read successful: ${graph.entities.length} entities, ${graph.relations.length} relations`);
    
    const nodeSearchResult = await searchNodes('Test');
    console.log(`✓ Node text search successful: ${nodeSearchResult.entities.length} entities found`);
    
    const nodeSearchVector = generateTestEmbedding(1); // Use the same vector as TestEntity1
    const vectorSearchResult = await searchNodes(nodeSearchVector);
    console.log(`✓ Node vector search successful: ${vectorSearchResult.entities.length} entities found`);
    
    // Test vector utilities
    console.log('\n--- Testing Vector Utilities ---');
    const vectorString = arrayToVectorString(nodeSearchVector);
    console.log(`✓ Vector string conversion successful: ${vectorString}`);
    
    // Test deletion operations
    console.log('\n--- Testing Deletion Operations ---');
    await deleteRelation('TestEntity1', 'TestEntity2', 'test_relation');
    console.log('✓ Relation deletion successful');
    
    await deleteEntity('TestEntity3');
    console.log('✓ Entity deletion successful');
    
    // Test snake_case interface compatibility
    console.log('\n--- Testing Snake Case Interface Compatibility ---');
    const legacyManager = await LegacyDatabaseManager.get_instance(config);
    
    await legacyManager.create_entities([
      {
        name: 'LegacyEntity',
        entityType: 'test',
        observations: ['Legacy observation 1', 'Legacy observation 2'],
        embedding: generateTestEmbedding(3), // Use a different seed for variety
      },
    ]);
    console.log('✓ Snake case entity creation successful');
    
    const legacyEntity = await legacyManager.get_entity('LegacyEntity');
    console.log(`✓ Snake case entity retrieval successful: ${legacyEntity.name}`);
    
    await legacyManager.create_relations([
      {
        from: 'LegacyEntity',
        to: 'TestEntity1',
        relationType: 'snake_case_relation',
      },
    ]);
    console.log('✓ Snake case relation creation successful');
    
    const legacyGraph = await legacyManager.read_graph();
    console.log(`✓ Snake case graph read successful: ${legacyGraph.entities.length} entities, ${legacyGraph.relations.length} relations`);
    
    await legacyManager.delete_relation('LegacyEntity', 'TestEntity1', 'snake_case_relation');
    console.log('✓ Snake case relation deletion successful');
    
    await legacyManager.delete_entity('LegacyEntity');
    console.log('✓ Snake case entity deletion successful');
    
    // Clean up remaining test entities
    await deleteEntity('TestEntity1');
    await deleteEntity('TestEntity2');
    
    // Close connections
    await coreManager.close();
    await legacyManager.close();
    
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the tests
runTests().catch(console.error);