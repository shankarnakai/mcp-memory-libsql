import { config } from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load environment variables from .env file
config();

// Get directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

/**
 * Configuration interface for the application
 */
export interface AppConfig {
  // Server configuration
  server: {
    name: string;
    version: string;
  };
  
  // Database configuration
  database: {
    url: string;
    authToken?: string;
  };
  
  // Embedding configuration
  embedding: {
    model: string;
    dimension: number;
    cachePath: string;
  };
  
  // Logging configuration
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    includeTimestamps: boolean;
  };
}

/**
 * Default configuration values
 */
const defaultConfig: AppConfig = {
  server: {
    name: 'mcp-memory-libsql',
    version: '0.0.14', // This should be read from package.json
  },
  database: {
    url: 'file:memory.db',
  },
  embedding: {
    model: 'Xenova/bge-small-en-v1.5',
    dimension: 384,
    cachePath: join(rootDir, 'models'),
  },
  logging: {
    level: 'info',
    includeTimestamps: true,
  },
};

/**
 * Load configuration from environment variables and defaults
 */
export function loadConfig(): AppConfig {
  try {
    // Read package.json for name and version
    const packageJson = JSON.parse(
      require('fs').readFileSync(join(rootDir, 'package.json'), 'utf8')
    );
    
    // Create configuration with environment variables and defaults
    const config: AppConfig = {
      server: {
        name: packageJson.name || defaultConfig.server.name,
        version: packageJson.version || defaultConfig.server.version,
      },
      database: {
        url: process.env.DATABASE_URL || defaultConfig.database.url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      },
      embedding: {
        model: process.env.EMBEDDING_MODEL || defaultConfig.embedding.model,
        dimension: parseInt(process.env.EMBEDDING_DIMENSION || String(defaultConfig.embedding.dimension), 10),
        cachePath: process.env.MODEL_CACHE_PATH || defaultConfig.embedding.cachePath,
      },
      logging: {
        level: (process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug') || defaultConfig.logging.level,
        includeTimestamps: process.env.LOG_TIMESTAMPS === 'true' || defaultConfig.logging.includeTimestamps,
      },
    };
    
    return config;
  } catch (error) {
    console.error('Error loading configuration:', error);
    return defaultConfig;
  }
}

// Export the configuration
export const appConfig = loadConfig();

// Export specific configurations for convenience
export const serverConfig = appConfig.server;
export const databaseConfig = appConfig.database;
export const embeddingConfig = appConfig.embedding;
export const loggingConfig = appConfig.logging;