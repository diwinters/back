"use strict";
/**
 * Custom Error Classes
 * Standardized error handling across services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitError = exports.ServiceUnavailableError = exports.ConflictError = exports.ValidationError = exports.NotFoundError = exports.UnauthorizedError = exports.AppError = exports.ErrorCode = void 0;
exports.isAppError = isAppError;
exports.toAppError = toAppError;
exports.errorHandler = errorHandler;
var ErrorCode;
(function (ErrorCode) {
    // Authentication errors (1000-1099)
    ErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorCode["FORBIDDEN"] = "FORBIDDEN";
    ErrorCode["INVALID_TOKEN"] = "INVALID_TOKEN";
    ErrorCode["TOKEN_EXPIRED"] = "TOKEN_EXPIRED";
    ErrorCode["INVALID_DID"] = "INVALID_DID";
    // User errors (1100-1199)
    ErrorCode["USER_NOT_FOUND"] = "USER_NOT_FOUND";
    ErrorCode["USER_ALREADY_EXISTS"] = "USER_ALREADY_EXISTS";
    // Driver errors (1200-1299)
    ErrorCode["DRIVER_NOT_FOUND"] = "DRIVER_NOT_FOUND";
    ErrorCode["DRIVER_NOT_AVAILABLE"] = "DRIVER_NOT_AVAILABLE";
    ErrorCode["DRIVER_NOT_ONLINE"] = "DRIVER_NOT_ONLINE";
    ErrorCode["DRIVER_ALREADY_EXISTS"] = "DRIVER_ALREADY_EXISTS";
    ErrorCode["NO_DRIVERS_AVAILABLE"] = "NO_DRIVERS_AVAILABLE";
    // Order errors (1300-1399)
    ErrorCode["ORDER_NOT_FOUND"] = "ORDER_NOT_FOUND";
    ErrorCode["ORDER_ALREADY_EXISTS"] = "ORDER_ALREADY_EXISTS";
    ErrorCode["INVALID_ORDER_STATUS"] = "INVALID_ORDER_STATUS";
    ErrorCode["ORDER_CANCELLED"] = "ORDER_CANCELLED";
    ErrorCode["INVALID_OTP"] = "INVALID_OTP";
    // Location errors (1400-1499)
    ErrorCode["INVALID_COORDINATES"] = "INVALID_COORDINATES";
    ErrorCode["LOCATION_OUT_OF_SERVICE"] = "LOCATION_OUT_OF_SERVICE";
    // Payment errors (1500-1599)
    ErrorCode["PAYMENT_FAILED"] = "PAYMENT_FAILED";
    ErrorCode["INSUFFICIENT_FUNDS"] = "INSUFFICIENT_FUNDS";
    // Validation errors (1600-1699)
    ErrorCode["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorCode["INVALID_INPUT"] = "INVALID_INPUT";
    ErrorCode["MISSING_REQUIRED_FIELD"] = "MISSING_REQUIRED_FIELD";
    ErrorCode["BAD_REQUEST"] = "BAD_REQUEST";
    // System errors (1700-1799)
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
    ErrorCode["SERVICE_UNAVAILABLE"] = "SERVICE_UNAVAILABLE";
    ErrorCode["DATABASE_ERROR"] = "DATABASE_ERROR";
    ErrorCode["EXTERNAL_SERVICE_ERROR"] = "EXTERNAL_SERVICE_ERROR";
    // Rate limiting (1800-1899)
    ErrorCode["RATE_LIMIT_EXCEEDED"] = "RATE_LIMIT_EXCEEDED";
    ErrorCode["TOO_MANY_REQUESTS"] = "TOO_MANY_REQUESTS";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
class AppError extends Error {
    code;
    statusCode;
    isOperational;
    details;
    constructor(message, code, statusCode = 500, isOperational = true, details) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        this.code = code;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.details = details;
        Error.captureStackTrace(this);
    }
    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                ...(this.details && { details: this.details }),
            },
        };
    }
}
exports.AppError = AppError;
// Specific error classes
class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', code = ErrorCode.UNAUTHORIZED) {
        super(message, code, 401);
    }
}
exports.UnauthorizedError = UnauthorizedError;
class NotFoundError extends AppError {
    constructor(message = 'Resource not found', code = ErrorCode.ORDER_NOT_FOUND) {
        super(message, code, 404);
    }
}
exports.NotFoundError = NotFoundError;
class ValidationError extends AppError {
    constructor(message = 'Validation failed', details) {
        super(message, ErrorCode.VALIDATION_ERROR, 400, true, details);
    }
}
exports.ValidationError = ValidationError;
class ConflictError extends AppError {
    constructor(message = 'Resource already exists', code) {
        super(message, code, 409);
    }
}
exports.ConflictError = ConflictError;
class ServiceUnavailableError extends AppError {
    constructor(message = 'Service temporarily unavailable') {
        super(message, ErrorCode.SERVICE_UNAVAILABLE, 503, true);
    }
}
exports.ServiceUnavailableError = ServiceUnavailableError;
class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded', retryAfter) {
        super(message, ErrorCode.RATE_LIMIT_EXCEEDED, 429, true, { retryAfter });
    }
}
exports.RateLimitError = RateLimitError;
// Helper functions
function isAppError(error) {
    return error instanceof AppError;
}
function toAppError(error) {
    if (isAppError(error)) {
        return error;
    }
    return new AppError(error.message || 'An unexpected error occurred', ErrorCode.INTERNAL_ERROR, 500, false, { originalError: error.message });
}
// Express error handler middleware
function errorHandler(err, req, res, next) {
    const error = toAppError(err);
    // Log error
    if (!error.isOperational) {
        console.error('Unhandled error:', err);
    }
    res.status(error.statusCode).json(error.toJSON());
}
