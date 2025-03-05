import { loggingConfig } from '../config/index.js';

/**
 * Log levels enum
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * Maps string log levels to LogLevel enum
 */
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  'error': LogLevel.ERROR,
  'warn': LogLevel.WARN,
  'info': LogLevel.INFO,
  'debug': LogLevel.DEBUG,
};

/**
 * Logger class for consistent logging across the application
 */
class Logger {
  private level: LogLevel;
  private includeTimestamps: boolean;

  constructor() {
    // Set default log level from config
    this.level = LOG_LEVEL_MAP[loggingConfig.level] ?? LogLevel.INFO;
    this.includeTimestamps = loggingConfig.includeTimestamps;
  }

  /**
   * Set the log level
   * @param level - The log level to set
   */
  public setLevel(level: LogLevel | string): void {
    if (typeof level === 'string') {
      this.level = LOG_LEVEL_MAP[level.toLowerCase()] ?? LogLevel.INFO;
    } else {
      this.level = level;
    }
  }

  /**
   * Set whether to include timestamps in logs
   * @param include - Whether to include timestamps
   */
  public setIncludeTimestamps(include: boolean): void {
    this.includeTimestamps = include;
  }

  /**
   * Format a log message with optional timestamp
   * @param level - The log level
   * @param message - The log message
   * @param args - Additional arguments
   * @returns Formatted log message
   */
  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = this.includeTimestamps ? `[${new Date().toISOString()}] ` : '';
    const prefix = `${timestamp}[${level.toUpperCase()}] `;
    
    // Format objects and arrays as JSON strings
    const formattedArgs = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return arg;
    });
    
    return `${prefix}${message}${formattedArgs.length > 0 ? ' ' + formattedArgs.join(' ') : ''}`;
  }

  /**
   * Log an error message
   * @param message - The error message
   * @param args - Additional arguments
   */
  public error(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(this.formatMessage('error', message, ...args));
    }
  }

  /**
   * Log a warning message
   * @param message - The warning message
   * @param args - Additional arguments
   */
  public warn(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(this.formatMessage('warn', message, ...args));
    }
  }

  /**
   * Log an info message
   * @param message - The info message
   * @param args - Additional arguments
   */
  public info(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.INFO) {
      console.info(this.formatMessage('info', message, ...args));
    }
  }

  /**
   * Log a debug message
   * @param message - The debug message
   * @param args - Additional arguments
   */
  public debug(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(this.formatMessage('debug', message, ...args));
    }
  }
}

// Export a singleton instance of the logger
export const logger = new Logger();