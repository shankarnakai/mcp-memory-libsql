#!/usr/bin/env node
import { DatabaseManager } from '../index.js';
import { databaseConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { embeddingService } from '../../services/embedding-service.js';

/**
 * Regenerates embeddings for all entities in the database after migration
 * This script should be run after the fix-vector-dimension.ts migration
 * to ensure all entities have embeddings with the correct dimension
 */
async function regenerateEmbeddingsAfterMigration() {
    logger.info('Starting embedding regeneration after migration...');
    
    // Get database connection
    const config = databaseConfig;
    const dbManager = await DatabaseManager.get_instance(config);
    
    try {
        // Get all entities from the database
        logger.info('Retrieving all entities from the database...');
        const entities = await dbManager.get_recent_entities(1000); // Set a high limit to get all entities
        
        const totalEntities = entities.length;
        logger.info(`Found ${totalEntities} entities to process`);
        
        // Process each entity
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < totalEntities; i++) {
            const entity = entities[i];
            const entityName = entity.name;
            const entityType = entity.entityType;
            
            try {
                logger.info(`Processing entity ${i+1}/${totalEntities}: ${entityName} (${entityType})`);
                
                // Get observations from the entity
                const observations = entity.observations;
                
                if (!observations || observations.length === 0) {
                    logger.warn(`Entity "${entityName}" has no observations, skipping embedding generation`);
                    continue;
                }
                
                // Generate embedding from observations
                logger.info(`Generating embedding for entity "${entityName}" using ${embeddingService.getModelName()}`);
                const text = observations.join(' ');
                const embedding = await embeddingService.generateEmbedding(text);
                logger.info(`Successfully generated embedding with dimension: ${embedding.length}`);
                
                // Update entity with new embedding
                await dbManager.create_entities([{
                    name: entityName,
                    entityType: entityType,
                    observations: observations,
                    embedding: embedding
                }]);
                
                logger.info(`Successfully updated embedding for entity "${entityName}"`);
                successCount++;
                
            } catch (error) {
                logger.error(`Error processing entity "${entityName}":`, error);
                errorCount++;
            }
            
            // Log progress every 10 entities
            if ((i + 1) % 10 === 0 || i === totalEntities - 1) {
                logger.info(`Progress: ${i+1}/${totalEntities} entities processed (${successCount} succeeded, ${errorCount} failed)`);
            }
        }
        
        logger.info(`Embedding regeneration complete. ${successCount} entities updated successfully, ${errorCount} entities failed.`);
        
    } catch (error) {
        logger.error('Error during embedding regeneration:', error);
        throw error;
    } finally {
        // Close database connection
        await dbManager.close();
    }
}

// Run the regeneration
regenerateEmbeddingsAfterMigration()
    .then(() => {
        logger.info('Embedding regeneration process completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Embedding regeneration process failed:', error);
        process.exit(1);
    });