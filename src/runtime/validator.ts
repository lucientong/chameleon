/**
 * Runtime Validator
 *
 * Provides IR-driven runtime parameter validation using Zod schemas.
 * Dynamically generates Zod schemas from IR types for request validation.
 */

import { z, ZodSchema, ZodError } from 'zod';
import type {
  IRType,
  IRMethod,
  IRParameter,
  IRSchema,
} from '../parsers/ir.js';
import {
  isPrimitiveType,
  isObjectType,
  isArrayType,
  isEnumType,
  isUnionType,
  isRefType,
  isAnyType,
  isVoidType,
} from '../parsers/ir.js';
import { ValidationError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for schema generation
 */
export interface ValidatorOptions {
  /** Whether to coerce types (e.g., string "123" to number 123) */
  coerceTypes?: boolean;
  /** Whether to strip unknown properties from objects */
  stripUnknown?: boolean;
  /** Custom format validators */
  formatValidators?: Record<string, (value: string) => boolean>;
}

/**
 * Validation result
 */
export interface ValidationResult<T = unknown> {
  /** Whether validation succeeded */
  success: boolean;
  /** Validated and transformed data (if success) */
  data?: T;
  /** Validation errors (if failed) */
  errors?: Array<{
    path: string;
    message: string;
    expected?: string;
    received?: string;
  }>;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<ValidatorOptions> = {
  coerceTypes: true,
  stripUnknown: true,
  formatValidators: {
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    uri: (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
    uuid: (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
    'date-time': (v) => !isNaN(Date.parse(v)),
    date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
    time: (v) => /^\d{2}:\d{2}:\d{2}/.test(v),
  },
};

// ============================================================================
// Validator Class
// ============================================================================

/**
 * Runtime validator that generates Zod schemas from IR types
 */
export class Validator {
  private options: Required<ValidatorOptions>;
  private schemaCache: Map<string, ZodSchema> = new Map();
  private typeRegistry: Map<string, IRType> = new Map();

  constructor(options?: ValidatorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Register named types from an IR schema
   */
  registerTypes(schema: IRSchema): void {
    if (schema.types) {
      for (const [name, type] of schema.types) {
        this.typeRegistry.set(name, type);
      }
    }

    // Also collect named types from services
    for (const service of schema.services) {
      for (const method of service.methods) {
        this.collectNamedTypes(method.input);
        this.collectNamedTypes(method.output);
        if (method.parameters) {
          for (const param of method.parameters) {
            this.collectNamedTypes(param.type);
          }
        }
      }
    }
  }

  /**
   * Recursively collect named types
   */
  private collectNamedTypes(type: IRType): void {
    if (isObjectType(type) && type.name) {
      if (!this.typeRegistry.has(type.name)) {
        this.typeRegistry.set(type.name, type);
      }
      for (const field of type.fields) {
        this.collectNamedTypes(field.type);
      }
    } else if (isArrayType(type)) {
      this.collectNamedTypes(type.elementType);
    } else if (isUnionType(type)) {
      if (type.name && !this.typeRegistry.has(type.name)) {
        this.typeRegistry.set(type.name, type);
      }
      for (const variant of type.variants) {
        this.collectNamedTypes(variant);
      }
    } else if (isEnumType(type) && type.name) {
      if (!this.typeRegistry.has(type.name)) {
        this.typeRegistry.set(type.name, type);
      }
    }
  }

  /**
   * Validate data against an IR type
   */
  validate<T = unknown>(data: unknown, type: IRType): ValidationResult<T> {
    const schema = this.getOrCreateSchema(type);
    return this.runValidation<T>(data, schema);
  }

  /**
   * Validate request parameters for a method
   */
  validateMethodInput<T = unknown>(
    data: unknown,
    method: IRMethod
  ): ValidationResult<T> {
    // If method has explicit parameters, build a combined schema
    if (method.parameters && method.parameters.length > 0) {
      const schema = this.buildParametersSchema(method.parameters);
      return this.runValidation<T>(data, schema);
    }

    // Otherwise validate against input type
    return this.validate<T>(data, method.input);
  }

  /**
   * Validate query parameters
   */
  validateQueryParams<T = unknown>(
    params: Record<string, string | string[] | undefined>,
    method: IRMethod
  ): ValidationResult<T> {
    if (!method.parameters) {
      return { success: true, data: {} as T };
    }

    const queryParams = method.parameters.filter((p) => p.location === 'query');
    if (queryParams.length === 0) {
      return { success: true, data: {} as T };
    }

    // Coerce string params to proper types
    const coercedData: Record<string, unknown> = {};
    for (const param of queryParams) {
      const value = params[param.name];
      if (value !== undefined) {
        coercedData[param.name] = this.coerceQueryParam(value, param.type);
      }
    }

    const schema = this.buildParametersSchema(queryParams);
    return this.runValidation<T>(coercedData, schema);
  }

  /**
   * Validate path parameters
   */
  validatePathParams<T = unknown>(
    params: Record<string, string>,
    method: IRMethod
  ): ValidationResult<T> {
    if (!method.parameters) {
      return { success: true, data: {} as T };
    }

    const pathParams = method.parameters.filter((p) => p.location === 'path');
    if (pathParams.length === 0) {
      return { success: true, data: {} as T };
    }

    // Coerce string params to proper types
    const coercedData: Record<string, unknown> = {};
    for (const param of pathParams) {
      const value = params[param.name];
      if (value !== undefined) {
        coercedData[param.name] = this.coerceQueryParam(value, param.type);
      }
    }

    const schema = this.buildParametersSchema(pathParams);
    return this.runValidation<T>(coercedData, schema);
  }

  /**
   * Validate request body
   */
  validateBody<T = unknown>(body: unknown, method: IRMethod): ValidationResult<T> {
    if (!method.parameters) {
      // Use input type directly
      return this.validate<T>(body, method.input);
    }

    const bodyParams = method.parameters.filter((p) => p.location === 'body');
    if (bodyParams.length === 0) {
      // Check if input type is not void
      if (!isVoidType(method.input)) {
        return this.validate<T>(body, method.input);
      }
      return { success: true, data: undefined as T };
    }

    // Usually there's only one body parameter
    const firstBodyParam = bodyParams[0];
    if (bodyParams.length === 1 && firstBodyParam) {
      return this.validate<T>(body, firstBodyParam.type);
    }

    // Multiple body params - treat as object
    const schema = this.buildParametersSchema(bodyParams);
    return this.runValidation<T>(body, schema);
  }

  /**
   * Get or create a Zod schema for an IR type
   */
  getOrCreateSchema(type: IRType): ZodSchema {
    // Check cache for named types
    if (isRefType(type)) {
      const cached = this.schemaCache.get(type.refName);
      if (cached) {return cached;}

      const resolvedType = this.typeRegistry.get(type.refName);
      if (resolvedType) {
        const schema = this.buildSchema(resolvedType);
        this.schemaCache.set(type.refName, schema);
        return schema;
      }
      // Unknown ref, allow any
      return z.any();
    }

    if (isObjectType(type) && type.name) {
      const cached = this.schemaCache.get(type.name);
      if (cached) {return cached;}

      const schema = this.buildSchema(type);
      this.schemaCache.set(type.name, schema);
      return schema;
    }

    if (isEnumType(type) && type.name) {
      const cached = this.schemaCache.get(type.name);
      if (cached) {return cached;}

      const schema = this.buildSchema(type);
      this.schemaCache.set(type.name, schema);
      return schema;
    }

    return this.buildSchema(type);
  }

  /**
   * Build a Zod schema from an IR type
   */
  private buildSchema(type: IRType): ZodSchema {
    if (isPrimitiveType(type)) {
      return this.buildPrimitiveSchema(type);
    }

    if (isObjectType(type)) {
      return this.buildObjectSchema(type);
    }

    if (isArrayType(type)) {
      const elementSchema = this.getOrCreateSchema(type.elementType);
      let arraySchema = z.array(elementSchema);

      if (type.minItems !== undefined) {
        arraySchema = arraySchema.min(type.minItems);
      }
      if (type.maxItems !== undefined) {
        arraySchema = arraySchema.max(type.maxItems);
      }

      return arraySchema;
    }

    if (isEnumType(type)) {
      const values = type.values as [string | number, ...(string | number)[]];
      if (values.length === 0) {
        return z.never();
      }
      return z.enum(values.map(String) as [string, ...string[]]);
    }

    if (isUnionType(type)) {
      if (type.variants.length === 0) {
        return z.never();
      }
      const firstVariant = type.variants[0];
      if (type.variants.length === 1 && firstVariant) {
        return this.getOrCreateSchema(firstVariant);
      }

      const schemas = type.variants.map((v) => this.getOrCreateSchema(v));
      return z.union(schemas as [ZodSchema, ZodSchema, ...ZodSchema[]]);
    }

    if (isRefType(type)) {
      return this.getOrCreateSchema(type);
    }

    if (isAnyType(type)) {
      return z.any();
    }

    if (isVoidType(type)) {
      return z.void();
    }

    return z.any();
  }

  /**
   * Build schema for primitive type
   */
  private buildPrimitiveSchema(type: IRType & { kind: 'primitive' }): ZodSchema {
    let schema: ZodSchema;

    switch (type.primitiveType) {
      case 'string': {
        const strSchema = this.options.coerceTypes ? z.coerce.string() : z.string();
        const validator = type.format ? this.options.formatValidators[type.format] : undefined;

        // Apply format validation
        if (validator) {
          schema = strSchema.refine(validator, {
            message: `Invalid ${type.format} format`,
          }) as ZodSchema;
        } else {
          schema = strSchema;
        }
        break;
      }

      case 'number': {
        schema = this.options.coerceTypes ? z.coerce.number() : z.number();
        break;
      }

      case 'integer': {
        schema = this.options.coerceTypes
          ? z.coerce.number().int()
          : z.number().int();
        break;
      }

      case 'boolean': {
        schema = this.options.coerceTypes ? z.coerce.boolean() : z.boolean();
        break;
      }

      default:
        schema = z.any();
    }

    // Handle enum constraint on primitive
    if (type.enum && type.enum.length > 0) {
      const enumValues = type.enum as [string | number | boolean, ...(string | number | boolean)[]];
      schema = z.enum(enumValues.map(String) as [string, ...string[]]);
    }

    return schema;
  }

  /**
   * Build schema for object type
   */
  private buildObjectSchema(type: IRType & { kind: 'object' }): ZodSchema {
    const shape: Record<string, ZodSchema> = {};

    for (const field of type.fields) {
      let fieldSchema = this.getOrCreateSchema(field.type);

      if (!field.required) {
        fieldSchema = fieldSchema.optional();
      }

      if (field.defaultValue !== undefined) {
        fieldSchema = fieldSchema.default(field.defaultValue);
      }

      shape[field.name] = fieldSchema;
    }

    const objectSchema = z.object(shape);

    // Handle additional properties - return as ZodSchema to avoid type issues
    if (type.additionalProperties === true) {
      return objectSchema.passthrough() as ZodSchema;
    } else if (type.additionalProperties && typeof type.additionalProperties === 'object') {
      // additionalProperties is an IR type
      return objectSchema.catchall(
        this.getOrCreateSchema(type.additionalProperties)
      ) as ZodSchema;
    } else if (this.options.stripUnknown) {
      return objectSchema.strict() as ZodSchema;
    }

    return objectSchema;
  }

  /**
   * Build schema for method parameters
   */
  private buildParametersSchema(params: IRParameter[]): ZodSchema {
    const shape: Record<string, ZodSchema> = {};

    for (const param of params) {
      let paramSchema = this.getOrCreateSchema(param.type);

      if (!param.required) {
        paramSchema = paramSchema.optional();
      }

      if (param.defaultValue !== undefined) {
        paramSchema = paramSchema.default(param.defaultValue);
      }

      shape[param.name] = paramSchema;
    }

    return z.object(shape);
  }

  /**
   * Coerce a query parameter string value to the appropriate type
   */
  private coerceQueryParam(
    value: string | string[],
    type: IRType
  ): unknown {
    // Handle array values
    if (Array.isArray(value)) {
      if (isArrayType(type)) {
        return value.map((v) => this.coerceQueryParam(v, type.elementType));
      }
      // Take first value if not expecting array
      const firstValue = value[0];
      if (firstValue === undefined) {
        return undefined;
      }
      return this.coerceSingleValue(firstValue, type);
    }

    return this.coerceSingleValue(value, type);
  }

  /**
   * Coerce a single string value to the appropriate type
   */
  private coerceSingleValue(value: string, type: IRType): unknown {
    if (isPrimitiveType(type)) {
      switch (type.primitiveType) {
        case 'integer':
          return parseInt(value, 10);
        case 'number':
          return parseFloat(value);
        case 'boolean':
          return value === 'true' || value === '1';
        default:
          return value;
      }
    }

    if (isEnumType(type)) {
      // Return as-is, validation will check if it's valid
      return value;
    }

    return value;
  }

  /**
   * Run validation and format result
   */
  private runValidation<T>(data: unknown, schema: ZodSchema): ValidationResult<T> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = schema.parse(data);
      return { success: true, data: result as T };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          success: false,
          errors: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
            expected: 'expected' in e ? String(e.expected) : undefined,
            received: 'received' in e ? String(e.received) : undefined,
          })),
        };
      }
      throw error;
    }
  }

  /**
   * Clear the schema cache
   */
  clearCache(): void {
    this.schemaCache.clear();
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a validator instance with registered types
 */
export function createValidator(
  schema?: IRSchema,
  options?: ValidatorOptions
): Validator {
  const validator = new Validator(options);
  if (schema) {
    validator.registerTypes(schema);
  }
  return validator;
}

/**
 * Validate data against an IR type (standalone)
 */
export function validateType<T = unknown>(
  data: unknown,
  type: IRType,
  options?: ValidatorOptions
): ValidationResult<T> {
  const validator = new Validator(options);
  return validator.validate<T>(data, type);
}

/**
 * Convert validation result to ValidationError if failed
 */
export function assertValid<T>(result: ValidationResult<T>): T {
  if (!result.success) {
    throw new ValidationError(
      'Validation failed',
      result.errors ?? []
    );
  }
  return result.data as T;
}
