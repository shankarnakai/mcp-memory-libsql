import { embeddingConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { EmbeddingError } from '../utils/errors.js';
import type { Tensor, FeatureExtractionPipeline } from '@xenova/transformers';

/**
 * Use the Singleton pattern to enable lazy construction of the pipeline.
 */
class EmbeddingModelManager {
  // Store model instances and their loading promises
  private static instances: Map<string, Promise<FeatureExtractionPipeline>> = new Map();
  // Lock to prevent concurrent operations on the same model
  private static modelLocks: Map<string, Promise<void>> = new Map();

  /**
   * Get or create a feature extraction pipeline for a model
   * @param modelName The name of the model to load
   * @returns A promise that resolves to the feature extraction pipeline
   */
  public static async getInstance(modelName: string): Promise<FeatureExtractionPipeline> {
    // Dynamically import transformers to avoid issues with ESM/CJS
    const { pipeline } = await import('@xenova/transformers');

    // Acquire lock for this model to prevent concurrent operations
    const lock = this.acquireLock(modelName);
    try {
      await lock;

      // Check if we already have this model
      if (this.instances.has(modelName)) {
        logger.debug(`Reusing existing pipeline for model: ${modelName}`);
        return this.instances.get(modelName)!;
      }

      // Create a new pipeline
      logger.info(`Creating new pipeline for model: ${modelName}`);
      const pipelinePromise = pipeline("feature-extraction", modelName, {
        progress_callback: (progress: { loaded: number; total: number; file: string }) => {
          const percentage = ((progress.loaded / progress.total) * 100).toFixed(2);
          logger.info(`Downloading ${progress.file}: ${percentage}% (${progress.loaded}/${progress.total} bytes)`);
        },
        cache_dir: embeddingConfig.cachePath,
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
  public static async disposeModel(modelName: string): Promise<void> {
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
 * Embedding service for generating and managing embeddings
 */
export class EmbeddingService {
  private modelName: string;
  private dimension: number;

  constructor(modelName?: string, dimension?: number) {
    this.modelName = modelName || embeddingConfig.model;
    this.dimension = dimension || embeddingConfig.dimension;
  }

  /**
   * Generate embeddings for a list of text inputs
   * @param inputs Array of text inputs to generate embeddings for
   * @returns Promise resolving to a 2D array of embeddings
   */
  public async generateEmbeddings(inputs: string[]): Promise<number[][]> {
    try {
      if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
        throw new EmbeddingError('Invalid inputs for embedding generation');
      }

      logger.info(`Generating embeddings for ${inputs.length} inputs using model: ${this.modelName}`);
      
      // Get the feature extraction pipeline
      const extractor = await EmbeddingModelManager.getInstance(this.modelName);
      
      // Generate embeddings
      const output: Tensor = await extractor(inputs, { 
        pooling: "mean", 
        normalize: true 
      });
      
      // Convert to array format
      const embeddings = output.tolist();
      logger.debug(`Successfully generated embeddings with dimension: ${embeddings[0].length}`);
      
      return embeddings;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error generating embeddings:', errorMessage);
      throw new EmbeddingError(`Failed to generate embeddings: ${errorMessage}`);
    }
  }

  /**
   * Generate a single embedding for a text input
   * @param input Text input to generate embedding for
   * @returns Promise resolving to an array representing the embedding
   */
  public async generateEmbedding(input: string): Promise<number[]> {
    if (!input || typeof input !== 'string') {
      throw new EmbeddingError('Invalid input for embedding generation');
    }
    
    const embeddings = await this.generateEmbeddings([input]);
    return embeddings[0];
  }

  /**
   * Get the dimension of the embeddings generated by this service
   * @returns The embedding dimension
   */
  public getDimension(): number {
    return this.dimension;
  }

  /**
   * Get the model name used by this service
   * @returns The model name
   */
  public getModelName(): string {
    return this.modelName;
  }
}

// Export a singleton instance of the embedding service
export const embeddingService = new EmbeddingService();

// Export the embedding dimension for convenience
export const EMBEDDING_DIMENSION = embeddingConfig.dimension;