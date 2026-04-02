/**
 * Intermediate Representation (IR) type definitions
 *
 * IR serves as the universal bridge between different API protocols.
 * All parsers convert their source schemas to IR, and all generators
 * consume IR to produce target protocol code.
 *
 * Design principles:
 * - Pure data structures (no classes) for easy serialization and testing
 * - Discriminated unions with `kind` field for type-safe pattern matching
 * - Optional fields for forward compatibility
 * - Factory functions for consistent object creation
 * - Type guards for runtime type checking
 */

// ============================================================================
// Primitive Types
// ============================================================================

/**
 * Primitive type identifiers supported by IR
 */
export type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean';

/**
 * Streaming mode for RPC methods
 * - client: Client streams data to server
 * - server: Server streams data to client
 * - bidi: Bidirectional streaming
 */
export type StreamingMode = 'client' | 'server' | 'bidi';

/**
 * HTTP methods supported by REST APIs
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Source type indicating which protocol the schema originated from
 */
export type SourceType = 'openapi' | 'protobuf' | 'graphql';

// ============================================================================
// IR Type Definitions (Discriminated Union)
// ============================================================================

/**
 * Base properties shared by all IR types
 */
interface IRTypeBase {
  /** Human-readable description */
  description?: string;
  /** Whether this type is deprecated */
  deprecated?: boolean;
  /** Additional metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Primitive type representation (string, number, integer, boolean)
 */
export interface IRPrimitiveType extends IRTypeBase {
  kind: 'primitive';
  /** The specific primitive type */
  primitiveType: PrimitiveType;
  /** Format hint (e.g., 'date-time', 'email', 'uuid') */
  format?: string;
  /** Default value */
  defaultValue?: string | number | boolean;
  /** Enum constraint for primitives (alternative to IREnumType) */
  enum?: (string | number | boolean)[];
}

/**
 * Object type with named fields
 */
export interface IRObjectType extends IRTypeBase {
  kind: 'object';
  /** Optional type name for named types */
  name?: string;
  /** Object fields */
  fields: IRField[];
  /** Additional properties type (for dictionary-like objects) */
  additionalProperties?: IRType | boolean;
}

/**
 * Array type with element type
 */
export interface IRArrayType extends IRTypeBase {
  kind: 'array';
  /** Type of array elements */
  elementType: IRType;
  /** Minimum number of items */
  minItems?: number;
  /** Maximum number of items */
  maxItems?: number;
  /** Whether items must be unique */
  uniqueItems?: boolean;
}

/**
 * Enum type with fixed set of values
 */
export interface IREnumType extends IRTypeBase {
  kind: 'enum';
  /** Optional enum name */
  name?: string;
  /** Allowed values */
  values: (string | number)[];
  /** Default value */
  defaultValue?: string | number;
}

/**
 * Union type (oneOf/anyOf in OpenAPI, union in GraphQL)
 */
export interface IRUnionType extends IRTypeBase {
  kind: 'union';
  /** Optional union name */
  name?: string;
  /** Variant types */
  variants: IRType[];
  /** Discriminator field name (if applicable) */
  discriminator?: string;
}

/**
 * Reference to another named type (for circular references)
 */
export interface IRRefType extends IRTypeBase {
  kind: 'ref';
  /** Referenced type name */
  refName: string;
}

/**
 * Any type (represents untyped data)
 */
export interface IRAnyType extends IRTypeBase {
  kind: 'any';
}

/**
 * Void/null type (for methods with no input or output)
 */
export interface IRVoidType extends IRTypeBase {
  kind: 'void';
}

/**
 * Discriminated union of all IR types
 */
export type IRType =
  | IRPrimitiveType
  | IRObjectType
  | IRArrayType
  | IREnumType
  | IRUnionType
  | IRRefType
  | IRAnyType
  | IRVoidType;

// ============================================================================
// IR Field Definition
// ============================================================================

/**
 * Field within an object type
 */
export interface IRField {
  /** Field name */
  name: string;
  /** Field type */
  type: IRType;
  /** Whether the field is required */
  required: boolean;
  /** Human-readable description */
  description?: string;
  /** Whether this field is deprecated */
  deprecated?: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// IR Method Definition
// ============================================================================

/**
 * Parameter location for HTTP APIs
 */
export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie' | 'body';

/**
 * Individual parameter definition
 */
export interface IRParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: IRType;
  /** Where the parameter is located */
  location: ParameterLocation;
  /** Whether the parameter is required */
  required: boolean;
  /** Human-readable description */
  description?: string;
  /** Default value */
  defaultValue?: unknown;
  /** Whether this parameter is deprecated */
  deprecated?: boolean;
}

/**
 * Method/operation definition
 */
export interface IRMethod {
  /** Method name (operationId in OpenAPI, rpc name in gRPC) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** HTTP method (for REST APIs) */
  httpMethod?: HttpMethod;
  /** URL path pattern (for REST APIs) */
  path?: string;
  /** Input type (request body or combined parameters) */
  input: IRType;
  /** Output type (response body) */
  output: IRType;
  /** Individual parameters (alternative to combined input) */
  parameters?: IRParameter[];
  /** Streaming mode (for gRPC) */
  streaming?: StreamingMode;
  /** Whether this method is deprecated */
  deprecated?: boolean;
  /** Tags for categorization */
  tags?: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// IR Service Definition
// ============================================================================

/**
 * Service definition (groups related methods)
 */
export interface IRService {
  /** Service name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Methods belonging to this service */
  methods: IRMethod[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// IR Schema (Top-level)
// ============================================================================

/**
 * Top-level schema definition (result of parsing)
 */
export interface IRSchema {
  /** Services defined in the schema */
  services: IRService[];
  /** Named types that can be referenced */
  types?: Map<string, IRType>;
  /** Source protocol type */
  sourceType: SourceType;
  /** Source protocol version (e.g., '3.0.0' for OpenAPI) */
  sourceVersion?: string;
  /** Schema title/name */
  title?: string;
  /** Schema description */
  description?: string;
  /** Schema version */
  version?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is an IRType
 */
export function isIRType(value: unknown): value is IRType {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    obj['kind'] === 'primitive' ||
    obj['kind'] === 'object' ||
    obj['kind'] === 'array' ||
    obj['kind'] === 'enum' ||
    obj['kind'] === 'union' ||
    obj['kind'] === 'ref' ||
    obj['kind'] === 'any' ||
    obj['kind'] === 'void'
  );
}

/**
 * Check if an IRType is a primitive type
 */
export function isPrimitiveType(type: IRType): type is IRPrimitiveType {
  return type.kind === 'primitive';
}

/**
 * Check if an IRType is an object type
 */
export function isObjectType(type: IRType): type is IRObjectType {
  return type.kind === 'object';
}

/**
 * Check if an IRType is an array type
 */
export function isArrayType(type: IRType): type is IRArrayType {
  return type.kind === 'array';
}

/**
 * Check if an IRType is an enum type
 */
export function isEnumType(type: IRType): type is IREnumType {
  return type.kind === 'enum';
}

/**
 * Check if an IRType is a union type
 */
export function isUnionType(type: IRType): type is IRUnionType {
  return type.kind === 'union';
}

/**
 * Check if an IRType is a reference type
 */
export function isRefType(type: IRType): type is IRRefType {
  return type.kind === 'ref';
}

/**
 * Check if an IRType is an any type
 */
export function isAnyType(type: IRType): type is IRAnyType {
  return type.kind === 'any';
}

/**
 * Check if an IRType is a void type
 */
export function isVoidType(type: IRType): type is IRVoidType {
  return type.kind === 'void';
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a primitive type
 */
export function createPrimitiveType(
  primitiveType: PrimitiveType,
  options?: Omit<IRPrimitiveType, 'kind' | 'primitiveType'>
): IRPrimitiveType {
  return {
    kind: 'primitive',
    primitiveType,
    ...options,
  };
}

/**
 * Create an object type
 */
export function createObjectType(
  fields: IRField[],
  options?: Omit<IRObjectType, 'kind' | 'fields'>
): IRObjectType {
  return {
    kind: 'object',
    fields,
    ...options,
  };
}

/**
 * Create an array type
 */
export function createArrayType(
  elementType: IRType,
  options?: Omit<IRArrayType, 'kind' | 'elementType'>
): IRArrayType {
  return {
    kind: 'array',
    elementType,
    ...options,
  };
}

/**
 * Create an enum type
 */
export function createEnumType(
  values: (string | number)[],
  options?: Omit<IREnumType, 'kind' | 'values'>
): IREnumType {
  return {
    kind: 'enum',
    values,
    ...options,
  };
}

/**
 * Create a union type
 */
export function createUnionType(
  variants: IRType[],
  options?: Omit<IRUnionType, 'kind' | 'variants'>
): IRUnionType {
  return {
    kind: 'union',
    variants,
    ...options,
  };
}

/**
 * Create a reference type
 */
export function createRefType(
  refName: string,
  options?: Omit<IRRefType, 'kind' | 'refName'>
): IRRefType {
  return {
    kind: 'ref',
    refName,
    ...options,
  };
}

/**
 * Create an any type
 */
export function createAnyType(options?: Omit<IRAnyType, 'kind'>): IRAnyType {
  return {
    kind: 'any',
    ...options,
  };
}

/**
 * Create a void type
 */
export function createVoidType(options?: Omit<IRVoidType, 'kind'>): IRVoidType {
  return {
    kind: 'void',
    ...options,
  };
}

/**
 * Create a field definition
 */
export function createField(
  name: string,
  type: IRType,
  required: boolean,
  options?: Omit<IRField, 'name' | 'type' | 'required'>
): IRField {
  return {
    name,
    type,
    required,
    ...options,
  };
}

/**
 * Create a parameter definition
 */
export function createParameter(
  name: string,
  type: IRType,
  location: ParameterLocation,
  required: boolean,
  options?: Omit<IRParameter, 'name' | 'type' | 'location' | 'required'>
): IRParameter {
  return {
    name,
    type,
    location,
    required,
    ...options,
  };
}

/**
 * Create a method definition
 */
export function createMethod(
  name: string,
  input: IRType,
  output: IRType,
  options?: Omit<IRMethod, 'name' | 'input' | 'output'>
): IRMethod {
  return {
    name,
    input,
    output,
    ...options,
  };
}

/**
 * Create a service definition
 */
export function createService(
  name: string,
  methods: IRMethod[],
  options?: Omit<IRService, 'name' | 'methods'>
): IRService {
  return {
    name,
    methods,
    ...options,
  };
}

/**
 * Create a schema definition
 */
export function createSchema(
  services: IRService[],
  sourceType: SourceType,
  options?: Omit<IRSchema, 'services' | 'sourceType'>
): IRSchema {
  return {
    services,
    sourceType,
    ...options,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the display name for an IR type
 */
export function getTypeName(type: IRType): string {
  switch (type.kind) {
    case 'primitive':
      return type.primitiveType;
    case 'object':
      return type.name ?? 'Object';
    case 'array':
      return `Array<${getTypeName(type.elementType)}>`;
    case 'enum':
      return type.name ?? 'Enum';
    case 'union':
      return type.name ?? type.variants.map(getTypeName).join(' | ');
    case 'ref':
      return type.refName;
    case 'any':
      return 'any';
    case 'void':
      return 'void';
  }
}

/**
 * Deep clone an IR type
 */
export function cloneType(type: IRType): IRType {
  return JSON.parse(JSON.stringify(type)) as IRType;
}

/**
 * Check if two IR types are structurally equal
 */
export function typeEquals(a: IRType, b: IRType): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Visit all types in an IR type tree
 */
export function visitTypes(
  type: IRType,
  visitor: (type: IRType) => void
): void {
  visitor(type);

  switch (type.kind) {
    case 'object':
      for (const field of type.fields) {
        visitTypes(field.type, visitor);
      }
      if (type.additionalProperties && typeof type.additionalProperties === 'object') {
        visitTypes(type.additionalProperties, visitor);
      }
      break;
    case 'array':
      visitTypes(type.elementType, visitor);
      break;
    case 'union':
      for (const variant of type.variants) {
        visitTypes(variant, visitor);
      }
      break;
  }
}

/**
 * Collect all referenced type names from an IR type tree
 */
export function collectRefs(type: IRType): Set<string> {
  const refs = new Set<string>();
  visitTypes(type, (t) => {
    if (isRefType(t)) {
      refs.add(t.refName);
    }
  });
  return refs;
}
