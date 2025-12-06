/**
 * Logger Utility
 * Structured logging for all services
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: any
}

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  service: string
  context?: LogContext
  error?: {
    message: string
    stack?: string
    code?: string
  }
}

class Logger {
  private service: string
  private minLevel: LogLevel
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  constructor(service: string = 'gominiapp') {
    this.service = service
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 
      (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.minLevel]
  }

  private formatEntry(level: LogLevel, message: string, context?: LogContext): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
    }

    if (context) {
      // Extract error if present
      if (context.error instanceof Error) {
        entry.error = {
          message: context.error.message,
          stack: context.error.stack,
          code: (context.error as any).code,
        }
        // Remove error from context to avoid duplication
        const { error, ...rest } = context
        if (Object.keys(rest).length > 0) {
          entry.context = rest
        }
      } else {
        entry.context = context
      }
    }

    return entry
  }

  private output(entry: LogEntry): void {
    const output = process.env.NODE_ENV === 'production'
      ? JSON.stringify(entry)
      : this.prettyFormat(entry)

    switch (entry.level) {
      case 'error':
        console.error(output)
        break
      case 'warn':
        console.warn(output)
        break
      default:
        console.log(output)
    }
  }

  private prettyFormat(entry: LogEntry): string {
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
    }
    const reset = '\x1b[0m'

    let output = `${colors[entry.level]}[${entry.level.toUpperCase()}]${reset} ${entry.timestamp} ${entry.message}`
    
    if (entry.context) {
      output += ` ${JSON.stringify(entry.context)}`
    }
    
    if (entry.error) {
      output += `\n${colors.error}Error: ${entry.error.message}${reset}`
      if (entry.error.stack) {
        output += `\n${entry.error.stack}`
      }
    }

    return output
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      this.output(this.formatEntry('debug', message, context))
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      this.output(this.formatEntry('info', message, context))
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      this.output(this.formatEntry('warn', message, context))
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      this.output(this.formatEntry('error', message, context))
    }
  }

  /**
   * Create a child logger with additional default context
   */
  child(defaultContext: LogContext): Logger {
    const childLogger = Object.create(this)
    const parentLog = this.output.bind(this)
    
    childLogger.output = (entry: LogEntry) => {
      entry.context = { ...defaultContext, ...entry.context }
      parentLog(entry)
    }

    return childLogger
  }

  /**
   * Create a logger for a specific service
   */
  forService(serviceName: string): Logger {
    return new Logger(serviceName)
  }
}

// Default singleton instance
export const logger = new Logger()

// Named export for creating service-specific loggers
export function createLogger(service: string): Logger {
  return new Logger(service)
}
