import { logger } from '../utils/logger.js';
import { EMBEDDING_DIMENSION } from './embedding-service.js';
import { DatabaseClient } from '../types/database.js';

/**
 * Vector service for handling vector operations
 */
export class VectorService {
  /**
   * Converts an array of numbers to a vector string representation with validation
   * @param numbers - Array of numbers to convert
   * @param dimension - Expected dimension of the vector (default: from embedding-service)
   * @returns Vector string representation
   */
  public static arrayToVectorString(
    numbers: number[] | undefined,
    dimension: number = EMBEDDING_DIMENSION,
  ): string {
    // If no embedding provided, create a default zero vector with the specified dimension
    if (!numbers || !Array.isArray(numbers)) {
      return `[${Array(dimension).fill('0.0').join(', ')}]`;
    }

    // Create a copy of the numbers array that we can modify
    let adjustedNumbers = [...numbers];
    
    // Add debug logging
    logger.debug(`Vector dimensions before adjustment: expected ${dimension}, got ${adjustedNumbers.length}`);
    
    // Adjust vector dimensions if they don't match expected dimension
    if (adjustedNumbers.length !== dimension) {
      logger.warn(
        `Vector dimension mismatch: expected ${dimension}, got ${adjustedNumbers.length}. Adjusting vector to match expected dimension.`,
      );
      
      // If the vector is too short, pad it with zeros
      if (adjustedNumbers.length < dimension) {
        while (adjustedNumbers.length < dimension) {
          adjustedNumbers.push(0.0);
        }
      }
      // If the vector is too long, truncate it
      else if (adjustedNumbers.length > dimension) {
        adjustedNumbers = adjustedNumbers.slice(0, dimension);
      }
      
      logger.debug(`Vector dimensions after adjustment: ${adjustedNumbers.length}`);
    }

    // Validate all elements are numbers and convert NaN/Infinity to 0
    const sanitizedNumbers = adjustedNumbers.map((n) => {
      if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) {
        logger.warn(
          `Invalid vector value detected, using 0.0 instead of: ${n}`,
        );
        return 0.0;
      }
      return n;
    });

    return `[${sanitizedNumbers.join(', ')}]`;
  }

  /**
   * Extracts a vector from binary format
   * @param client - Database client instance
   * @param embedding - Binary embedding data
   * @returns Array of numbers representing the vector
   */
  public static async extractVector(
    client: DatabaseClient,
    embedding: Uint8Array,
  ): Promise<number[]> {
    try {
      const result = await client.execute({
        sql: 'SELECT vector_extract(?) as vec',
        args: [embedding],
      });
      
      if (!result.rows || result.rows.length === 0) {
        logger.warn('No results returned from vector_extract');
        return Array(EMBEDDING_DIMENSION).fill(0);
      }
      
      const vecStr = result.rows[0].vec as string;
      
      if (!vecStr) {
        logger.warn('Empty vector string returned from vector_extract');
        return Array(EMBEDDING_DIMENSION).fill(0);
      }
      
      return JSON.parse(vecStr);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error extracting vector: ${errorMessage}`);
      return Array(EMBEDDING_DIMENSION).fill(0);
    }
  }

  /**
   * Calculates cosine similarity between two vectors
   * @param a - First vector
   * @param b - Second vector
   * @returns Cosine similarity (1 = identical, 0 = orthogonal, -1 = opposite)
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) {
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Calculates Euclidean distance between two vectors
   * @param a - First vector
   * @param b - Second vector
   * @returns Euclidean distance
   */
  public static euclideanDistance(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) {
      return Number.MAX_VALUE;
    }
    
    let sum = 0;
    
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    
    return Math.sqrt(sum);
  }
}

// Export convenience functions
export const arrayToVectorString = VectorService.arrayToVectorString;
export const extractVector = VectorService.extractVector;
export const cosineSimilarity = VectorService.cosineSimilarity;
export const euclideanDistance = VectorService.euclideanDistance;