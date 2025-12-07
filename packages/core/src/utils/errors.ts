/**
 * Custom Error Classes
 * Standardized error handling across services
 */

export enum ErrorCode {
  // Authentication errors (1000-1099)
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_DID = 'INVALID_DID',
  
  // User errors (1100-1199)
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS',
  
  // Driver errors (1200-1299)
  DRIVER_NOT_FOUND = 'DRIVER_NOT_FOUND',
  DRIVER_NOT_AVAILABLE = 'DRIVER_NOT_AVAILABLE',
  DRIVER_NOT_ONLINE = 'DRIVER_NOT_ONLINE',
  DRIVER_ALREADY_EXISTS = 'DRIVER_ALREADY_EXISTS',
  NO_DRIVERS_AVAILABLE = 'NO_DRIVERS_AVAILABLE',
  
  // Order errors (1300-1399)
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_ALREADY_EXISTS = 'ORDER_ALREADY_EXISTS',
  INVALID_ORDER_STATUS = 'INVALID_ORDER_STATUS',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  INVALID_OTP = 'INVALID_OTP',
  
  // Location errors (1400-1499)
  INVALID_COORDINATES = 'INVALID_COORDINATES',
  LOCATION_OUT_OF_SERVICE = 'LOCATION_OUT_OF_SERVICE',
  
  // Payment errors (1500-1599)
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  
  // Validation errors (1600-1699)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // System errors (1700-1799)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  
  // Rate limiting (1800-1899)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
}

interface ErrorDetails {
  [key: string]: any
}

export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly isOperational: boolean
  public readonly details?: ErrorDetails

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: ErrorDetails
  ) {
    super(message)
    
    Object.setPrototypeOf(this, new.target.prototype)
    
    this.code = code
    this.statusCode = statusCode
    this.isOperational = isOperational
    this.details = details
    
    Error.captureStackTrace(this)
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    }
  }
}

// Specific error classes
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code: ErrorCode = ErrorCode.UNAUTHORIZED) {
    super(message, code, 401)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', code: ErrorCode = ErrorCode.ORDER_NOT_FOUND) {
    super(message, code, 404)
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', details?: ErrorDetails) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, true, details)
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists', code: ErrorCode) {
    super(message, code, 409)
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(message, ErrorCode.SERVICE_UNAVAILABLE, 503, true)
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, ErrorCode.RATE_LIMIT_EXCEEDED, 429, true, { retryAfter })
  }
}

// Helper functions
export function isAppError(error: any): error is AppError {
  return error instanceof AppError
}

export function toAppError(error: any): AppError {
  if (isAppError(error)) {
    return error
  }
  
  return new AppError(
    error.message || 'An unexpected error occurred',
    ErrorCode.INTERNAL_ERROR,
    500,
    false,
    { originalError: error.message }
  )
}

// Express error handler middleware
export function errorHandler(err: any, req: any, res: any, next: any) {
  const error = toAppError(err)
  
  // Log error
  if (!error.isOperational) {
    console.error('Unhandled error:', err)
  }
  
  res.status(error.statusCode).json(error.toJSON())
}
