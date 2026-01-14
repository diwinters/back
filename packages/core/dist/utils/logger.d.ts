/**
 * Logger Utility
 * Structured logging for all services
 */
interface LogContext {
    [key: string]: any;
}
declare class Logger {
    private service;
    private minLevel;
    private levels;
    constructor(service?: string);
    private shouldLog;
    private formatEntry;
    private output;
    private prettyFormat;
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext): void;
    /**
     * Create a child logger with additional default context
     */
    child(defaultContext: LogContext): Logger;
    /**
     * Create a logger for a specific service
     */
    forService(serviceName: string): Logger;
}
export declare const logger: Logger;
export declare function createLogger(service: string): Logger;
export {};
