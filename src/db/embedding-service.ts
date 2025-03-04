import { logger } from '../utils/logger.js';
import type { Tensor, FeatureExtractionPipeline } from '@xenova/transformers';

/**
 * Default embedding model to use
 * BGE models are good general-purpose embedding models
 */
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

/**
 * Default embedding dimension
 * This should match the output dimension of the model being used
 */
export const DEFAULT_EMBEDDING_DIMENSION = 384;

/**
 * Use the Singleton pattern to enable lazy construction of the pipeline.
 * This is based on the TransformersJSModelsSingleton implementation
 * from the reference code.
 */
class EmbeddingModelSingleton {
	// Store model instances and their loading promises
	static instances: Map<string, Promise<FeatureExtractionPipeline>> = new Map();
	// Lock to prevent concurrent operations on the same model
	static modelLocks: Map<string, Promise<void>> = new Map();

	/**
	 * Get or create a feature extraction pipeline for a model
	 * @param modelName The name of the model to load
	 * @returns A promise that resolves to the feature extraction pipeline
	 */
	static async getInstance(modelName: string): Promise<FeatureExtractionPipeline> {
		// Dynamically import transformers to avoid issues with ESM/CJS
		const { pipeline } = await import('@xenova/transformers');

		// Acquire lock for this model to prevent concurrent operations
		const lock = this.acquireLock(modelName);
		try {
			await lock;

			// Check if we already have this model
			if (this.instances.has(modelName)) {
				logger.info(`Reusing existing pipeline for model: ${modelName}`);
				return this.instances.get(modelName)!;
			}

			// Create a new pipeline
			logger.info(`Creating new pipeline for model: ${modelName}`);
			const pipelinePromise = pipeline("feature-extraction", modelName, {
				progress_callback: (progress: { loaded: number; total: number; file: string }) => {
					const percentage = ((progress.loaded / progress.total) * 100).toFixed(2);
					logger.info(`Downloading ${progress.file}: ${percentage}% (${progress.loaded}/${progress.total} bytes)`);
				},
				cache_dir: "./models", // Cache models locally
			});

			// Store the promise in our instances map
			this.instances.set(modelName, pipelinePromise);

			return pipelinePromise;
		} finally {
			// Release the lock when done
			this.releaseLock(modelName);
		}
	}

	/**
	 * Dispose of a model pipeline to free memory
	 * @param modelName The name of the model to dispose
	 */
	static async disposeModel(modelName: string): Promise<void> {
		// Acquire lock for this model to prevent concurrent operations
		const lock = this.acquireLock(modelName);
		try {
			await lock;

			if (this.instances.has(modelName)) {
				logger.info(`Disposing pipeline for model: ${modelName}`);
				const pipeline = await this.instances.get(modelName)!;
				await pipeline.dispose();
				this.instances.delete(modelName);
				logger.info(`Pipeline for model ${modelName} disposed successfully`);
			}
		} catch (error) {
			logger.error(`Error disposing model ${modelName}:`, error);
		} finally {
			// Release the lock when done
			this.releaseLock(modelName);
		}
	}

	/**
	 * Acquire a lock for operations on a specific model
	 * @param modelName The name of the model to lock
	 * @returns A promise that resolves when the lock is acquired
	 */
	private static acquireLock(modelName: string): Promise<void> {
		// If no lock exists yet, create one that resolves immediately
		if (!this.modelLocks.has(modelName)) {
			this.modelLocks.set(modelName, Promise.resolve());
		}

		// Get the current lock
		const currentLock = this.modelLocks.get(modelName)!;

		// Create a new lock that will resolve when the current operation completes
		let resolveLock!: () => void;
		const newLock = new Promise<void>(resolve => {
			resolveLock = resolve;
		});

		// Store the resolver function along with the promise
		const lockWithResolver = Object.assign(newLock, { resolver: resolveLock });

		// Update the lock in the map
		this.modelLocks.set(modelName, lockWithResolver as Promise<void>);

		// Wait for the current lock to resolve before proceeding
		return currentLock.then(() => { });
	}

	/**
	 * Release a lock for a specific model
	 * @param modelName The name of the model to unlock
	 */
	private static releaseLock(modelName: string): void {
		// Get the current lock
		const lockPromise = this.modelLocks.get(modelName);
		if (lockPromise) {
			// Call the resolver function to release the lock
			// @ts-expect-error - We know this property exists because we added it
			const resolver = lockPromise.resolver;
			if (typeof resolver === 'function') {
				resolver();
			}
		}
	}
}

/**
 * Generate embeddings for a list of text inputs
 * @param inputs Array of text inputs to generate embeddings for
 * @param modelName Name of the model to use for embedding generation
 * @returns Promise resolving to a 2D array of embeddings
 */
export async function generateEmbeddings(
	inputs: string[],
	modelName: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[][]> {
	try {
		logger.info(`Generating embeddings for ${inputs.length} inputs using model: ${modelName}`);
		
		// Get the feature extraction pipeline
		const extractor = await EmbeddingModelSingleton.getInstance(modelName);
		
		// Generate embeddings
		const output: Tensor = await extractor(inputs, { 
			pooling: "mean", 
			normalize: true 
		});
		
		// Convert to array format
		const embeddings = output.tolist();
		logger.info(`Successfully generated embeddings with dimension: ${embeddings[0].length}`);
		
		return embeddings;
	} catch (error) {
		logger.error('Error generating embeddings:', error);
		throw new Error(`Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Generate a single embedding for a text input
 * @param input Text input to generate embedding for
 * @param modelName Name of the model to use for embedding generation
 * @returns Promise resolving to an array representing the embedding
 */
export async function generateEmbedding(
	input: string,
	modelName: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[]> {
	const embeddings = await generateEmbeddings([input], modelName);
	return embeddings[0];
}