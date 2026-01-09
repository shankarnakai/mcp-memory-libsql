#!/usr/bin/env node
import { DatabaseManager } from './index.js';
import { databaseConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { embeddingService } from '../services/embedding-service.js';

/**
 * Regenerates embeddings for all entities in the database
 * This is useful when:
 * 1. Migrating from a previous version without embeddings
 * 2. Changing the embedding model
 * 3. Fixing corrupted embeddings
 */
async function regenerateAllEmbeddings() {
    logger.info('Starting embedding regeneration for all entities...');
    
    // Get database connection
    const config = databaseConfig;
    const dbManager = await DatabaseManager.get_instance(config);
    
    try {
        // Get all entities from the database using get_recent_entities with a high limit
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
                
                // Update entity - embeddings are now auto-generated per observation
                logger.info(`Updating entity "${entityName}" to regenerate per-observation embeddings`);
                await dbManager.create_entities([{
                    name: entityName,
                    entityType: entityType,
                    observations: observations,
                }]);

                logger.info(`Successfully updated entity "${entityName}" with auto-generated embeddings`);
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
regenerateAllEmbeddings()
    .then(() => {
        logger.info('Embedding regeneration process completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Embedding regeneration process failed:', error);
        process.exit(1);
    });