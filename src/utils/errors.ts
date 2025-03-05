
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Base error class for the application
 * Extends Error with additional properties for better error handling
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Database error class for database-related errors
 */
export class DatabaseError extends AppError {
  constructor(message: string, code: string = 'DATABASE_ERROR') {
    super(message, code, 500, true);
  }
}

/**
 * Validation error class for input validation errors
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, true);
  }
}

/**
 * Not found error class for resource not found errors
 */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404, true);
  }
}

/**
 * Embedding error class for embedding-related errors
 */
export class EmbeddingError extends AppError {
  constructor(message: string) {
    super(message, 'EMBEDDING_ERROR', 500, true);
  }
}

/**
 * Foreign key constraint error class for database constraint errors
 */
export class ForeignKeyConstraintError extends DatabaseError {
  constructor(message: string) {
    super(message, 'FOREIGN_KEY_CONSTRAINT_ERROR');
  }
}

/**
 * Converts an error to an MCP error for the MCP server
 * @param error - The error to convert
 * @returns McpError instance
 */
export function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) {
    return error;
  }
  
  if (error instanceof ValidationError) {
    return new McpError(ErrorCode.InvalidParams, error.message);
  }
  
  if (error instanceof NotFoundError) {
    return new McpError(ErrorCode.MethodNotFound, error.message);
  }
  
  if (error instanceof DatabaseError) {
    // Check for specific database errors
    if (error instanceof ForeignKeyConstraintError) {
      return new McpError(ErrorCode.InvalidParams, error.message);
    }
    return new McpError(ErrorCode.InternalError, error.message);
  }
  
  if (error instanceof EmbeddingError) {
    return new McpError(ErrorCode.InternalError, error.message);
  }
  
  // Generic error handling
  const errorMessage = error instanceof Error ? error.message : String(error);
  return new McpError(ErrorCode.InternalError, errorMessage);
}

/**
 * Parses a database error and returns an appropriate AppError
 * @param error - The database error to parse
 * @returns AppError instance
 */
export function parseDatabaseError(error: unknown): AppError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Check for foreign key constraint error
  if (errorMessage.includes('SQLITE_CONSTRAINT_FOREIGNKEY')) {
    return new ForeignKeyConstraintError(
      'Foreign key constraint failed. Make sure all referenced entities exist.'
    );
  }
  
  // Check for unique constraint error
  if (errorMessage.includes('SQLITE_CONSTRAINT_UNIQUE')) {
    return new DatabaseError(
      'Unique constraint failed. An entity with this name already exists.',
      'UNIQUE_CONSTRAINT_ERROR'
    );
  }
  
  // Default to generic database error
  return new DatabaseError(errorMessage);
}