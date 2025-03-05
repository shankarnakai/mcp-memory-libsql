import { Entity, Relation } from '../types/index.js';

// Types for database configuration
export interface DatabaseConfig {
	url: string;
	authToken?: string;
}

// Types for internal database operations
export interface EntityCreateParams {
	name: string;
	entityType: string;
	observations: string[];
	embedding?: number[];
	relations?: Array<{
		target: string;
		relationType: string;
	}>;
}

export interface RelationCreateParams {
	from: string;
	to: string;
	relationType: string;
}

export interface GraphResult {
	entities: Entity[];
	relations: Relation[];
}

// Interface for database client with methods matching @libsql/client
export interface DatabaseClient {
	execute: (stmt: string | { sql: string; args?: any[] }) => Promise<any>;
	transaction: (mode: string) => Promise<any>;
	batch: (statements: Array<{ sql: string; args: any[] }>, mode: string) => Promise<any>;
	close: () => Promise<void>;
}