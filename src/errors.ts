/**
 * Custom error classes for Chameleon
 */

/**
 * Base error class for all Chameleon errors
 */
export class ChameleonError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ChameleonError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Error thrown during schema parsing
 */
export class ParserError extends ChameleonError {
  constructor(
    message: string,
    public readonly sourceType: 'openapi' | 'protobuf' | 'graphql',
    public readonly location?: {
      file?: string;
      path?: string;
      line?: number;
      column?: number;
    },
    cause?: Error
  ) {
    super(message, 'PARSER_ERROR', cause);
    this.name = 'ParserError';
  }
}

/**
 * Error thrown during code generation
 */
export class GeneratorError extends ChameleonError {
  constructor(
    message: string,
    public readonly targetType: 'rest' | 'graphql' | 'grpc' | 'typescript',
    cause?: Error
  ) {
    super(message, 'GENERATOR_ERROR', cause);
    this.name = 'GeneratorError';
  }
}

/**
 * Error thrown during runtime translation
 */
export class RuntimeError extends ChameleonError {
  constructor(
    message: string,
    public readonly operation?: string,
    cause?: Error
  ) {
    super(message, 'RUNTIME_ERROR', cause);
    this.name = 'RuntimeError';
  }
}

/**
 * Error thrown during request validation
 */
export class ValidationError extends ChameleonError {
  constructor(
    message: string,
    public readonly validationErrors: Array<{
      path: string;
      message: string;
      expected?: string;
      received?: string;
    }>,
    cause?: Error
  ) {
    super(message, 'VALIDATION_ERROR', cause);
    this.name = 'ValidationError';
  }
}
