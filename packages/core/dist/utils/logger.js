"use strict";
/**
 * Logger Utility
 * Structured logging for all services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
class Logger {
    service;
    minLevel;
    levels = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    };
    constructor(service = 'gominiapp') {
        this.service = service;
        this.minLevel = process.env.LOG_LEVEL ||
            (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
    }
    shouldLog(level) {
        return this.levels[level] >= this.levels[this.minLevel];
    }
    formatEntry(level, message, context) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            service: this.service,
        };
        if (context) {
            // Extract error if present
            if (context.error instanceof Error) {
                entry.error = {
                    message: context.error.message,
                    stack: context.error.stack,
                    code: context.error.code,
                };
                // Remove error from context to avoid duplication
                const { error, ...rest } = context;
                if (Object.keys(rest).length > 0) {
                    entry.context = rest;
                }
            }
            else {
                entry.context = context;
            }
        }
        return entry;
    }
    output(entry) {
        const output = process.env.NODE_ENV === 'production'
            ? JSON.stringify(entry)
            : this.prettyFormat(entry);
        switch (entry.level) {
            case 'error':
                console.error(output);
                break;
            case 'warn':
                console.warn(output);
                break;
            default:
                console.log(output);
        }
    }
    prettyFormat(entry) {
        const colors = {
            debug: '\x1b[36m', // cyan
            info: '\x1b[32m', // green
            warn: '\x1b[33m', // yellow
            error: '\x1b[31m', // red
        };
        const reset = '\x1b[0m';
        let output = `${colors[entry.level]}[${entry.level.toUpperCase()}]${reset} ${entry.timestamp} ${entry.message}`;
        if (entry.context) {
            output += ` ${JSON.stringify(entry.context)}`;
        }
        if (entry.error) {
            output += `\n${colors.error}Error: ${entry.error.message}${reset}`;
            if (entry.error.stack) {
                output += `\n${entry.error.stack}`;
            }
        }
        return output;
    }
    debug(message, context) {
        if (this.shouldLog('debug')) {
            this.output(this.formatEntry('debug', message, context));
        }
    }
    info(message, context) {
        if (this.shouldLog('info')) {
            this.output(this.formatEntry('info', message, context));
        }
    }
    warn(message, context) {
        if (this.shouldLog('warn')) {
            this.output(this.formatEntry('warn', message, context));
        }
    }
    error(message, context) {
        if (this.shouldLog('error')) {
            this.output(this.formatEntry('error', message, context));
        }
    }
    /**
     * Create a child logger with additional default context
     */
    child(defaultContext) {
        const childLogger = Object.create(this);
        const parentLog = this.output.bind(this);
        childLogger.output = (entry) => {
            entry.context = { ...defaultContext, ...entry.context };
            parentLog(entry);
        };
        return childLogger;
    }
    /**
     * Create a logger for a specific service
     */
    forService(serviceName) {
        return new Logger(serviceName);
    }
}
// Default singleton instance
exports.logger = new Logger();
// Named export for creating service-specific loggers
function createLogger(service) {
    return new Logger(service);
}
