import { createClient } from '@libsql/client';
import { databaseConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';
import { EMBEDDING_DIMENSION } from './embedding-service.js';
import type { DatabaseClient } from '../types/database.js';

/**
 * Database service for managing database connections and operations
 */
export class DatabaseService {
  private static instance: DatabaseService;
  private client: DatabaseClient;
  private isInitialized: boolean = false;

  /**
   * Private constructor to enforce singleton pattern
   * @param url - Database URL
   * @param authToken - Optional authentication token
   */
  private constructor(url: string, authToken?: string) {
    if (!url) {
      throw new DatabaseError('Database URL is required');
    }
    
    logger.info(`Creating database client for URL: ${url}`);
    // Create the client and cast it to our DatabaseClient interface
    // We need to use 'as unknown as' to bypass TypeScript's type checking
    // because the actual Client type doesn't exactly match our DatabaseClient interface
    this.client = createClient({
      url,
      authToken,
    }) as unknown as DatabaseClient;
  }

  /**
   * Gets the singleton instance of DatabaseService
   * @returns DatabaseService instance
   */
  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      const { url, authToken } = databaseConfig;
      DatabaseService.instance = new DatabaseService(url, authToken);
    }
    return DatabaseService.instance;
  }

  /**
   * Gets the database client
   * @returns Database client
   */
  public getClient(): DatabaseClient {
    return this.client;
  }

  /**
   * Initializes the database schema
   * @returns Promise that resolves when initialization is complete
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Database already initialized, skipping initialization');
      return;
    }

    try {
      logger.info(`Initializing database schema with vector dimension: ${EMBEDDING_DIMENSION}`);
      
      // Create tables if they don't exist - each as a single statement
      await this.client.execute({
        sql: `
          CREATE TABLE IF NOT EXISTS entities (
            name TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            embedding F32_BLOB(${EMBEDDING_DIMENSION}), -- Using configurable dimension
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `
      });

      await this.client.execute({
        sql: `
          CREATE TABLE IF NOT EXISTS observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (entity_name) REFERENCES entities(name)
          )
        `
      });

      await this.client.execute({
        sql: `
          CREATE TABLE IF NOT EXISTS relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source) REFERENCES entities(name),
            FOREIGN KEY (target) REFERENCES entities(name)
          )
        `
      });

      // Create all indexes in a single batch transaction
      await this.client.batch(
        [
          {
            sql: 'CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)',
            args: [],
          },
          {
            sql: 'CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name)',
            args: [],
          },
          {
            sql: 'CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source)',
            args: [],
          },
          {
            sql: 'CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target)',
            args: [],
          },
          {
            sql: 'CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities(libsql_vector_idx(embedding))',
            args: [],
          },
        ],
        'write',
      );

      this.isInitialized = true;
      logger.info('Database schema initialized successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Database initialization failed:', errorMessage);
      throw new DatabaseError(`Database initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Closes the database connection
   * @returns Promise that resolves when the connection is closed
   */
  public async close(): Promise<void> {
    try {
      logger.info('Closing database connection');
      await this.client.close();
      logger.info('Database connection closed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error closing database connection:', errorMessage);
    }
  }

  /**
   * Executes a transaction with the provided callback
   * @param callback - Function to execute within the transaction
   * @returns Promise that resolves with the result of the callback
   */
  public async transaction<T>(callback: (txn: any) => Promise<T>): Promise<T> {
    const txn = await this.client.transaction('write');
    try {
      const result = await callback(txn);
      await txn.commit();
      return result;
    } catch (error) {
      await txn.rollback();
      throw error;
    }
  }
}

// Export a singleton instance of the database service
export const databaseService = DatabaseService.getInstance();