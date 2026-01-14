/**
 * Custom Error Classes
 * Standardized error handling across services
 */
export declare enum ErrorCode {
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    INVALID_TOKEN = "INVALID_TOKEN",
    TOKEN_EXPIRED = "TOKEN_EXPIRED",
    INVALID_DID = "INVALID_DID",
    USER_NOT_FOUND = "USER_NOT_FOUND",
    USER_ALREADY_EXISTS = "USER_ALREADY_EXISTS",
    DRIVER_NOT_FOUND = "DRIVER_NOT_FOUND",
    DRIVER_NOT_AVAILABLE = "DRIVER_NOT_AVAILABLE",
    DRIVER_NOT_ONLINE = "DRIVER_NOT_ONLINE",
    DRIVER_ALREADY_EXISTS = "DRIVER_ALREADY_EXISTS",
    NO_DRIVERS_AVAILABLE = "NO_DRIVERS_AVAILABLE",
    ORDER_NOT_FOUND = "ORDER_NOT_FOUND",
    ORDER_ALREADY_EXISTS = "ORDER_ALREADY_EXISTS",
    INVALID_ORDER_STATUS = "INVALID_ORDER_STATUS",
    ORDER_CANCELLED = "ORDER_CANCELLED",
    INVALID_OTP = "INVALID_OTP",
    INVALID_COORDINATES = "INVALID_COORDINATES",
    LOCATION_OUT_OF_SERVICE = "LOCATION_OUT_OF_SERVICE",
    PAYMENT_FAILED = "PAYMENT_FAILED",
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    INVALID_INPUT = "INVALID_INPUT",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
    BAD_REQUEST = "BAD_REQUEST",
    INTERNAL_ERROR = "INTERNAL_ERROR",
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
    DATABASE_ERROR = "DATABASE_ERROR",
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
    TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS"
}
interface ErrorDetails {
    [key: string]: any;
}
export declare class AppError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly isOperational: boolean;
    readonly details?: ErrorDetails;
    constructor(message: string, code: ErrorCode, statusCode?: number, isOperational?: boolean, details?: ErrorDetails);
    toJSON(): {
        error: {
            details: ErrorDetails;
            code: ErrorCode;
            message: string;
        };
    };
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string, code?: ErrorCode);
}
export declare class NotFoundError extends AppError {
    constructor(message?: string, code?: ErrorCode);
}
export declare class ValidationError extends AppError {
    constructor(message?: string, details?: ErrorDetails);
}
export declare class ConflictError extends AppError {
    constructor(message: string, code: ErrorCode);
}
export declare class ServiceUnavailableError extends AppError {
    constructor(message?: string);
}
export declare class RateLimitError extends AppError {
    constructor(message?: string, retryAfter?: number);
}
export declare function isAppError(error: any): error is AppError;
export declare function toAppError(error: any): AppError;
export declare function errorHandler(err: any, req: any, res: any, next: any): void;
export {};
