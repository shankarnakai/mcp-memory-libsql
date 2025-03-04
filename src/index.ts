#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequest,
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import json2md from 'json2md';
import { DatabaseManager } from './db/client.js';
import { get_database_config } from './db/config.js';
import { Entity, Relation } from './types/index.js';
import { pipeline } from '@xenova/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);
const { name, version } = pkg;

// Interface for output format options
interface OutputFormatOptions {
	format: 'json' | 'markdown';
}

// Default output format
const DEFAULT_OUTPUT_FORMAT: OutputFormatOptions = {
	format: 'markdown'
};

// TransformersJS model configuration
interface TransformersConfig {
	modelName: string;
	cacheDir: string;
}

// Default embedding model configuration
const DEFAULT_EMBEDDING_MODEL: TransformersConfig = {
	modelName: 'Xenova/bge-small-en-v1.5',
	cacheDir: './models',
	// Expected vector dimensions for this model
	// This must match the dimensions of vectors stored in the database
	dimensions: 768
};

// TransformersJS model configuration
interface TransformersConfig {
	modelName: string;
	cacheDir: string;
	dimensions?: number;
}

// Use the Singleton pattern to enable lazy construction of the pipeline.
class TransformersJSModelsSingleton {
	// Store model instances and their loading promises
	static instances: Map<string, Promise<any>> = new Map();
	// Lock to prevent concurrent operations on the same model
	static modelLocks: Map<string, Promise<void>> = new Map();

	/**
	 * Get or create a feature extraction pipeline for a model
	 * @param modelName The name of the model to load
	 * @returns A promise that resolves to the feature extraction pipeline
	 */
	static async getInstance(modelName: string, cacheDir: string = './models'): Promise<any> {
		// Acquire lock for this model to prevent concurrent operations
		const lock = this.acquireLock(modelName);
		try {
			await lock;

			// Check if we already have this model
			if (this.instances.has(modelName)) {
				console.error(`Reusing existing pipeline for model: ${modelName}`);
				return this.instances.get(modelName)!;
			}

			// Create a new pipeline
			console.error(`Creating new pipeline for model: ${modelName}`);
			const pipelinePromise = pipeline("feature-extraction", modelName, {
				progress_callback: (progress: { loaded: number; total: number; file: string }) => {
					const percentage = ((progress.loaded / progress.total) * 100).toFixed(2);
					console.error(`Downloading ${progress.file}: ${percentage}% (${progress.loaded}/${progress.total} bytes)`);
				},
				cache_dir: cacheDir,
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
				console.error(`Disposing pipeline for model: ${modelName}`);
				const pipeline = await this.instances.get(modelName)!;
				await pipeline.dispose();
				this.instances.delete(modelName);
				console.error(`Pipeline for model ${modelName} disposed successfully`);
			}
		} catch (error) {
			console.error(`Error disposing model ${modelName}:`, error);
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
 * Calculate embeddings using TransformersJS
 * @param text The text to embed
 * @param config The model configuration
 * @returns A promise that resolves to the embedding vector
 */
async function calculateEmbedding(texts: string[], config: TransformersConfig = DEFAULT_EMBEDDING_MODEL): Promise<number[][]> {
	console.error(`Calculating embeddings for model: ${config.modelName} with ${texts.length} inputs`);
	const extractor = await TransformersJSModelsSingleton.getInstance(config.modelName, config.cacheDir);
	const output = await extractor(texts, { pooling: "mean", normalize: true });
	console.error(`Embeddings calculated successfully`);

	const embeddings = output.tolist();
	
	// Check if dimensions are specified in the config
	if (config.dimensions !== undefined) {
		const targetDimensions = config.dimensions;
		// Ensure all embeddings have the correct dimensions
		return embeddings.map((embedding: number[]) => {
			const currentDimensions = embedding.length;
			
			// If dimensions match, return as is
			if (currentDimensions === targetDimensions) {
				return embedding;
			}
			
			console.error(`Dimension mismatch: got ${currentDimensions}, expected ${targetDimensions}`);
			
			// If dimensions are smaller than expected, pad with zeros
			if (currentDimensions < targetDimensions) {
				console.error(`Padding embedding from ${currentDimensions} to ${targetDimensions} dimensions`);
				return [...embedding, ...Array(targetDimensions - currentDimensions).fill(0)];
			}
			
			// If dimensions are larger than expected, truncate
			if (currentDimensions > targetDimensions) {
				console.error(`Truncating embedding from ${currentDimensions} to ${targetDimensions} dimensions`);
				return embedding.slice(0, targetDimensions);
			}
			
			return embedding; // This should never be reached
		});
	}
	
	return embeddings;
}

// Function to convert entities and relations to markdown
function convertToMarkdown(data: { entities: Entity[]; relations: Relation[] }): string {
	const mdContent = [];
	
	// Add entities section
	if (data.entities.length > 0) {
		mdContent.push({ h2: 'Entities' });
		
		data.entities.forEach(entity => {
			mdContent.push({ h3: entity.name });
			mdContent.push({ p: `**Type**: ${entity.entityType}` });
			
			if (entity.observations.length > 0) {
				mdContent.push({ h4: 'Observations' });
				mdContent.push({
					ul: entity.observations.map(obs => obs)
				});
			}
			
			if (entity.embedding) {
				mdContent.push({ h4: 'Embedding' });
				mdContent.push({
					p: `Vector with ${entity.embedding.length} dimensions`
				});
			}
		});
	}
	
	// Add relations section
	if (data.relations.length > 0) {
		mdContent.push({ h2: 'Relations' });
		
		const relationItems = data.relations.map(relation =>
			`**${relation.from}** → **${relation.to}** (${relation.relationType})`
		);
		
		mdContent.push({
			ul: relationItems
		});
	}
	
	// If no data, add a message
	if (data.entities.length === 0 && data.relations.length === 0) {
		mdContent.push({ p: 'No entities or relations found.' });
	}
	
	return json2md(mdContent);
}

class LibSqlMemoryServer {
	private server: Server;
	private db!: DatabaseManager;

	private constructor() {
		this.server = new Server(
			{ name, version },
			{
				capabilities: {
					tools: {
						create_entities: {},
						search_nodes: {},
						read_graph: {},
						create_relations: {},
						delete_entity: {},
						delete_relation: {},
					},
				},
			},
		);

		// Error handling
		this.server.onerror = (error: Error) =>
			console.error('[MCP Error]', error);
		process.on('SIGINT', async () => {
			await this.db?.close();
			await this.server.close();
			process.exit(0);
		});
	}

	public static async create(): Promise<LibSqlMemoryServer> {
		const instance = new LibSqlMemoryServer();
		const config = get_database_config();
		instance.db = await DatabaseManager.get_instance(config);
		instance.setup_tool_handlers();
		return instance;
	}

	private setup_tool_handlers() {
		this.server.setRequestHandler(
			ListToolsRequestSchema,
			async () => ({
				tools: [
					{
						name: 'create_entities',
						description:
							'Create new entities with observations and optional embeddings',
						inputSchema: {
							type: 'object',
							properties: {
								entities: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											name: { type: 'string' },
											entityType: { type: 'string' },
											observations: {
												type: 'array',
												items: { type: 'string' },
											},
											embedding: {
												type: 'array',
												items: { type: 'number' },
												description:
													'Optional vector embedding for similarity search',
											},
										},
										required: ['name', 'entityType', 'observations'],
									},
								},
							},
							required: ['entities'],
						},
					},
					{
						name: 'search_nodes',
						description:
							'Search for entities and their relations using text or vector similarity',
						inputSchema: {
							type: 'object',
							properties: {
								query: {
									oneOf: [
										{
											type: 'string',
											description: 'Text search query',
										},
										{
											type: 'array',
											items: { type: 'number' },
											description: 'Vector for similarity search',
										},
									],
								},
								format: {
									type: 'string',
									enum: ['json', 'markdown'],
									description: 'Output format (default: markdown)',
								},
							},
							required: ['query'],
						},
					},
					{
						name: 'read_graph',
						description: 'Get recent entities and their relations',
						inputSchema: {
							type: 'object',
							properties: {
								format: {
									type: 'string',
									enum: ['json', 'markdown'],
									description: 'Output format (default: markdown)',
								},
							},
							required: [],
						},
					},
					{
						name: 'create_relations',
						description: 'Create relations between entities',
						inputSchema: {
							type: 'object',
							properties: {
								relations: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											source: { type: 'string' },
											target: { type: 'string' },
											type: { type: 'string' },
										},
										required: ['source', 'target', 'type'],
									},
								},
							},
							required: ['relations'],
						},
					},
					{
						name: 'delete_entity',
						description:
							'Delete an entity and all its associated data (observations and relations)',
						inputSchema: {
							type: 'object',
							properties: {
								name: {
									type: 'string',
									description: 'Name of the entity to delete',
								},
							},
							required: ['name'],
						},
					},
					{
						name: 'delete_relation',
						description:
							'Delete a specific relation between entities',
						inputSchema: {
							type: 'object',
							properties: {
								source: {
									type: 'string',
									description: 'Source entity name',
								},
								target: {
									type: 'string',
									description: 'Target entity name',
								},
								type: {
									type: 'string',
									description: 'Type of relation',
								},
							},
							required: ['source', 'target', 'type'],
						},
					},
				],
			}),
		);

		this.server.setRequestHandler(
			CallToolRequestSchema,
			async (request: CallToolRequest) => {
				try {
					switch (request.params.name) {
						case 'create_entities': {
							const entities = request.params.arguments
								?.entities as Array<{
								name: string;
								entityType: string;
								observations: string[];
								embedding?: number[];
							}>;
							if (!entities) {
								throw new McpError(
									ErrorCode.InvalidParams,
									'Missing entities parameter',
								);
							}
							await this.db.create_entities(entities);
							return {
								content: [
									{
										type: 'text',
										text: `Successfully processed ${entities.length} entities (created new or updated existing)`,
									},
								],
							};
						}

						case 'search_nodes': {
							const query = request.params.arguments?.query;
							if (query === undefined || query === null) {
								throw new McpError(
									ErrorCode.InvalidParams,
									'Missing query parameter',
								);
							}
							// Validate query type
							if (
								!(typeof query === 'string' || Array.isArray(query))
							) {
								throw new McpError(
									ErrorCode.InvalidParams,
									'Query must be either a string or number array',
								);
							}
							
							// Get format option, default to markdown
							const formatOption = (request.params.arguments?.format as string) || DEFAULT_OUTPUT_FORMAT.format;
							console.error(`[DEBUG] search_nodes format option: ${formatOption}`);
							console.error(`[DEBUG] request.params.arguments:`, JSON.stringify(request.params.arguments));
							
							// If query is a string and not a vector, generate embedding for semantic search
							let searchQuery = query;
							if (typeof query === 'string' && query.length > 0) {
								try {
									// Generate embedding for the query text
									const embeddings = await calculateEmbedding([query]);
									if (embeddings && embeddings.length > 0) {
										// Use the generated embedding for vector search
										searchQuery = embeddings[0];
										console.error(`Generated embedding for query: "${query.substring(0, 30)}..."`);
									}
								} catch (embeddingError) {
									console.error(`Error generating embedding for query: ${embeddingError}`);
									// Fall back to text search if embedding fails
								}
							}
							
							const result = await this.db.search_nodes(searchQuery);
							
							// Return in requested format
							if (formatOption === 'json') {
								return {
									content: [
										{
											type: 'text',
											text: JSON.stringify(result, null, 2),
										},
									],
								};
							} else {
								// Default to markdown
								return {
									content: [
										{
											type: 'text',
											text: convertToMarkdown(result),
										},
									],
								};
							}
						}

						case 'read_graph': {
							// Get format option, default to markdown
							const formatOption = (request.params.arguments?.format as string) || DEFAULT_OUTPUT_FORMAT.format;
							console.error(`[DEBUG] read_graph format option: ${formatOption}`);
							console.error(`[DEBUG] read_graph request.params.arguments:`, JSON.stringify(request.params.arguments));
							
							const result = await this.db.read_graph();
							
							// Return in requested format
							if (formatOption === 'json') {
								return {
									content: [
										{
											type: 'text',
											text: JSON.stringify(result, null, 2),
										},
									],
								};
							} else {
								// Default to markdown
								return {
									content: [
										{
											type: 'text',
											text: convertToMarkdown(result),
										},
									],
								};
							}
						}

						case 'create_relations': {
							const relations = request.params.arguments
								?.relations as Array<{
								source: string;
								target: string;
								type: string;
							}>;
							if (!relations) {
								throw new McpError(
									ErrorCode.InvalidParams,
									'Missing relations parameter',
								);
							}
							// Convert to internal Relation type
							const internalRelations: Relation[] = relations.map(
								(r) => ({
									from: r.source,
									to: r.target,
									relationType: r.type,
								}),
							);
							await this.db.create_relations(internalRelations);
							return {
								content: [
									{
										type: 'text',
										text: `Created ${relations.length} relations`,
									},
								],
							};
						}

						case 'delete_entity': {
							const name = request.params.arguments?.name;
							if (!name || typeof name !== 'string') {
								throw new McpError(
									ErrorCode.InvalidParams,
									'Missing or invalid entity name',
								);
							}
							await this.db.delete_entity(name);
							return {
								content: [
									{
										type: 'text',
										text: `Successfully deleted entity "${name}" and its associated data`,
									},
								],
							};
						}

						case 'delete_relation': {
							const { source, target, type } =
								request.params.arguments || {};
							if (
								!source ||
								!target ||
								!type ||
								typeof source !== 'string' ||
								typeof target !== 'string' ||
								typeof type !== 'string'
							) {
								throw new McpError(
									ErrorCode.InvalidParams,
									'Missing or invalid relation parameters',
								);
							}
							await this.db.delete_relation(source, target, type);
							return {
								content: [
									{
										type: 'text',
										text: `Successfully deleted relation: ${source} -> ${target} (${type})`,
									},
								],
							};
						}

						default:
							throw new McpError(
								ErrorCode.MethodNotFound,
								`Unknown tool: ${request.params.name}`,
							);
					}
				} catch (error) {
					if (error instanceof McpError) throw error;
					throw new McpError(
						ErrorCode.InternalError,
						error instanceof Error ? error.message : String(error),
					);
				}
			},
		);
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error('LibSQL Memory MCP server running on stdio');
	}
}

LibSqlMemoryServer.create()
	.then((server) => server.run())
	.catch(console.error);
