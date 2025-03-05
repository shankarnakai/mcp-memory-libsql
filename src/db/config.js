import { databaseConfig } from '../config/index.js';

/**
 * Get database configuration for migrations and other db operations
 * @returns {import('./types.js').DatabaseConfig} Database configuration object
 */
export function get_database_config() {
  return databaseConfig;
}