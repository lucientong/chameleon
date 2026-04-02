/**
 * Chameleon - Schema-driven API Protocol Conversion Gateway
 *
 * A middleware/gateway that seamlessly transforms APIs between REST, GraphQL, and gRPC.
 *
 * @packageDocumentation
 */

// ============================================================================
// Phase 1: IR Types and OpenAPI Parser
// ============================================================================

// IR type definitions
export {
  // Types
  type PrimitiveType,
  type StreamingMode,
  type HttpMethod,
  type SourceType,
  type IRType,
  type IRPrimitiveType,
  type IRObjectType,
  type IRArrayType,
  type IREnumType,
  type IRUnionType,
  type IRRefType,
  type IRAnyType,
  type IRVoidType,
  type IRField,
  type IRParameter,
  type ParameterLocation,
  type IRMethod,
  type IRService,
  type IRSchema,
  // Type guards
  isIRType,
  isPrimitiveType,
  isObjectType,
  isArrayType,
  isEnumType,
  isUnionType,
  isRefType,
  isAnyType,
  isVoidType,
  // Factory functions
  createPrimitiveType,
  createObjectType,
  createArrayType,
  createEnumType,
  createUnionType,
  createRefType,
  createAnyType,
  createVoidType,
  createField,
  createParameter,
  createMethod,
  createService,
  createSchema,
  // Utility functions
  getTypeName,
  cloneType,
  typeEquals,
  visitTypes,
  collectRefs,
} from './parsers/ir.js';

// OpenAPI Parser
export {
  OpenAPIParser,
  parseOpenAPIFile,
  parseOpenAPIDocument,
  type OpenAPIParseOptions,
} from './parsers/openapi.js';

// Error classes
export {
  ChameleonError,
  ParserError,
  GeneratorError,
  RuntimeError,
  ValidationError,
} from './errors.js';

// ============================================================================
// Phase 2: GraphQL Generator (TODO)
// ============================================================================
// export * from './generators/graphql-generator.js';
// export * from './generators/type-generator.js';

// ============================================================================
// Phase 3: Runtime and Gateway (TODO)
// ============================================================================
// export * from './runtime/translator.js';
// export * from './runtime/validator.js';
// export * from './generators/rest-generator.js';

// ============================================================================
// Phase 4: Protobuf and gRPC (TODO)
// ============================================================================
// export * from './parsers/protobuf.js';
// export * from './generators/grpc-generator.js';

// ============================================================================
// Phase 5: DataLoader and Stream Bridge (TODO)
// ============================================================================
// export * from './runtime/dataloader.js';
// export * from './runtime/stream-bridge.js';

// ============================================================================
// Phase 6: Hot Reload and Admin (TODO)
// ============================================================================
// export * from './parsers/graphql.js';
// export * from './watcher/schema-watcher.js';
// export * from './watcher/hot-reload.js';
