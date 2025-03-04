/**
 * Simple logger utility for consistent logging across the application
 */
export const logger = {
    /**
     * Log an info message
     * @param message The message to log
     * @param args Additional arguments to log
     */
    info: (message: string, ...args: any[]) => {
        console.info(`[INFO] ${message}`, ...args);
    },

    /**
     * Log a warning message
     * @param message The message to log
     * @param args Additional arguments to log
     */
    warn: (message: string, ...args: any[]) => {
        console.warn(`[WARN] ${message}`, ...args);
    },

    /**
     * Log an error message
     * @param message The message to log
     * @param args Additional arguments to log
     */
    error: (message: string, ...args: any[]) => {
        console.error(`[ERROR] ${message}`, ...args);
    },

    /**
     * Log a debug message
     * @param message The message to log
     * @param args Additional arguments to log
     */
    debug: (message: string, ...args: any[]) => {
        if (process.env.DEBUG) {
            console.debug(`[DEBUG] ${message}`, ...args);
        }
    }
};