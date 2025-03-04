import { DatabaseClient } from './types.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_EMBEDDING_DIMENSION } from './embedding-service.js';

/**
 * Converts an array of numbers to a vector string representation with validation
 * @param numbers - Array of numbers to convert
 * @param dimension - Expected dimension of the vector (default: from embedding-service)
 * @returns Vector string representation
 */
export function arrayToVectorString(
	numbers: number[] | undefined,
	dimension: number = DEFAULT_EMBEDDING_DIMENSION,
): string {
	// If no embedding provided, create a default zero vector with the specified dimension
	if (!numbers || !Array.isArray(numbers)) {
		return `[${Array(dimension).fill('0.0').join(', ')}]`;
	}

	// Create a copy of the numbers array that we can modify
	let adjustedNumbers = [...numbers];
	
	// Add debug logging
	console.log(`DEBUG: Vector dimensions before adjustment: expected ${dimension}, got ${adjustedNumbers.length}`);
	
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
		
		// Add debug logging
		console.log(`DEBUG: Vector dimensions after adjustment: ${adjustedNumbers.length}`);
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
export async function extractVector(
	client: DatabaseClient,
	embedding: Uint8Array,
): Promise<number[]> {
	const result = await client.execute({
		sql: 'SELECT vector_extract(?) as vec',
		args: [embedding],
	});
	const vecStr = result.rows[0].vec as string;
	return JSON.parse(vecStr);
}