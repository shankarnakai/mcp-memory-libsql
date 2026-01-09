/**
 * Helper script: generate an embedding for a text string, run the
 * semantic similarity query used by search_nodes, and print ranked results.
 *
 * Usage:
 *   npm run ts-node -- src/db/run-vector-query.ts "your text here"
 *   # or with ts-node directly:
 *   npx ts-node --esm src/db/run-vector-query.ts "your text here"
 */

import process from 'process';
import { embeddingService } from '../services/embedding-service.js';
import { databaseService } from '../services/database-service.js';
import { logger } from '../utils/logger.js';

// Match the constants used in GraphService.searchByVector (and allow env override)
const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD ?? '0.4');
const MAX_RESULTS = Number(process.env.SIMILARITY_MAX_RESULTS ?? '10');

async function main() {
  const text = process.argv.slice(2).join(' ').trim();

  if (!text) {
    console.error('Usage: ts-node --esm src/db/run-vector-query.ts "text to search"');
    process.exit(1);
  }

  try {
    // Ensure database schema exists
    await databaseService.initialize();

    logger.info(`Generating embedding for: "${text}"`);
    const embedding = await embeddingService.generateEmbedding(text);
    const vectorString = JSON.stringify(embedding);

    const client = databaseService.getClient();

    const results = await client.execute({
      sql: `
        WITH matching_observations AS (
          SELECT
            o.entity_name,
            o.id AS observation_id,
            vector_distance_cos(o.embedding, vector32(?)) AS distance
          FROM observations o
          WHERE o.embedding IS NOT NULL
            AND vector_distance_cos(o.embedding, vector32(?)) <= ?
        ),
        entity_matches AS (
          SELECT
            mo.entity_name,
            COUNT(DISTINCT mo.observation_id) AS match_count,
            AVG(mo.distance) AS avg_distance
          FROM matching_observations mo
          GROUP BY mo.entity_name
        )
        SELECT em.entity_name, em.match_count, em.avg_distance
        FROM entity_matches em
        ORDER BY em.match_count DESC, em.avg_distance ASC
        LIMIT ?
      `,
      args: [vectorString, vectorString, SIMILARITY_THRESHOLD, MAX_RESULTS],
    });

    if (results.rows.length === 0) {
      console.log('No semantic matches found.');
      return;
    }

    console.table(
      results.rows.map((row: any) => ({
        entity: row.entity_name,
        matches: Number(row.match_count),
        avg_distance: Number(row.avg_distance),
      })),
    );
  } catch (error) {
    console.error('Failed to run semantic query:', error);
    process.exit(1);
  } finally {
    try {
      await databaseService.close();
    } catch (closeError) {
      logger.error('Failed to close database after query:', closeError);
    }
  }
}

main();
