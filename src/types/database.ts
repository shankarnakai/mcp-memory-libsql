/**
 * Interface for database client with methods matching @libsql/client
 */
export interface DatabaseClient {
  /**
   * Execute a SQL statement
   * @param stmt - SQL statement or object with SQL and args
   * @returns Promise resolving to the result of the statement
   */
  execute: (stmt: string | { sql: string; args?: any[] }) => Promise<{
    columns: string[];
    rows: any[];
    rowsAffected: number;
    lastInsertRowid?: number | bigint;
  }>;

  /**
   * Start a transaction
   * @param mode - Transaction mode ('read' or 'write')
   * @returns Promise resolving to a transaction object
   */
  transaction: (mode: 'read' | 'write') => Promise<{
    execute: (stmt: string | { sql: string; args?: any[] }) => Promise<{
      columns: string[];
      rows: any[];
      rowsAffected: number;
      lastInsertRowid?: number | bigint;
    }>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
  }>;

  /**
   * Execute a batch of SQL statements
   * @param statements - Array of SQL statements with args
   * @param mode - Batch mode ('read' or 'write')
   * @returns Promise resolving to the results of the statements
   */
  batch: (
    statements: Array<{ sql: string; args: any[] }>,
    mode: 'read' | 'write'
  ) => Promise<{
    columns: string[][];
    rows: any[][];
    rowsAffected: number[];
    lastInsertRowids?: (number | bigint)[];
  }>;

  /**
   * Close the database connection
   * @returns Promise resolving when the connection is closed
   */
  close: () => Promise<void>;
}

/**
 * Interface for database transaction
 */
export interface DatabaseTransaction {
  /**
   * Execute a SQL statement within the transaction
   * @param stmt - SQL statement or object with SQL and args
   * @returns Promise resolving to the result of the statement
   */
  execute: (stmt: string | { sql: string; args?: any[] }) => Promise<{
    columns: string[];
    rows: any[];
    rowsAffected: number;
    lastInsertRowid?: number | bigint;
  }>;

  /**
   * Commit the transaction
   * @returns Promise resolving when the transaction is committed
   */
  commit: () => Promise<void>;

  /**
   * Rollback the transaction
   * @returns Promise resolving when the transaction is rolled back
   */
  rollback: () => Promise<void>;
}

/**
 * Interface for database query result
 */
export interface QueryResult {
  columns: string[];
  rows: any[];
  rowsAffected: number;
  lastInsertRowid?: number | bigint;
}

/**
 * Interface for database batch result
 */
export interface BatchResult {
  columns: string[][];
  rows: any[][];
  rowsAffected: number[];
  lastInsertRowids?: (number | bigint)[];
}