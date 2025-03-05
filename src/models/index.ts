/**
 * Core entity model representing a node in the knowledge graph
 */
export interface Entity {
  /** Unique name identifier for the entity */
  name: string;
  
  /** Type of entity (e.g., person, topic, concept) */
  entityType: string;
  
  /** List of textual observations about the entity */
  observations: string[];
  
  /** Optional vector embedding for similarity search */
  embedding?: number[];
  
  /** Optional creation timestamp */
  createdAt?: Date;
}

/**
 * Relation model representing a connection between entities
 */
export interface Relation {
  /** Source entity name */
  from: string;
  
  /** Target entity name */
  to: string;
  
  /** Type of relation (e.g., has_interest_in, works_on) */
  relationType: string;
  
  /** Optional vector embedding for the relation */
  embedding?: number[];
  
  /** Optional creation timestamp */
  createdAt?: Date;
}

/**
 * Search result model for entity similarity search
 */
export interface SearchResult {
  /** The matched entity */
  entity: Entity;
  
  /** Distance/similarity score (lower is more similar) */
  distance: number;
}

/**
 * Graph result model for graph operations
 */
export interface GraphResult {
  /** List of entities in the graph */
  entities: Entity[];
  
  /** List of relations in the graph */
  relations: Relation[];
}

/**
 * Parameters for creating entities
 */
export interface EntityCreateParams {
  /** Entity name */
  name: string;
  
  /** Entity type */
  entityType: string;
  
  /** List of observations */
  observations: string[];
  
  /** Optional embedding vector */
  embedding?: number[];
  
  /** Optional relations to create with this entity */
  relations?: Array<{
    /** Target entity name */
    target: string;
    
    /** Relation type */
    relationType: string;
  }>;
}

/**
 * Parameters for creating relations
 */
export interface RelationCreateParams {
  /** Source entity name */
  from: string;
  
  /** Target entity name */
  to: string;
  
  /** Relation type */
  relationType: string;
}

/**
 * Database configuration model
 */
export interface DatabaseConfig {
  /** Database URL */
  url: string;
  
  /** Optional authentication token */
  authToken?: string;
}