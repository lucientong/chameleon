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
// Phase 2: GraphQL Generator
// ============================================================================

// GraphQL Generator
export {
  GraphQLGenerator,
  generateGraphQL,
  generateGraphQLTypeDefs,
  type GraphQLGeneratorOptions,
  type GraphQLGeneratorOutput,
  type ResolverContext,
  type ResolverFn,
  type ResolverMap,
  type OperationInfo,
} from './generators/graphql-generator.js';

// TypeScript Type Generator
export {
  TypeGenerator,
  generateTypeScript,
  generateTypeScriptCode,
  type TypeGeneratorOptions,
  type TypeGeneratorOutput,
} from './generators/type-generator.js';

// ============================================================================
// Phase 3: Runtime and Gateway
// ============================================================================

// Runtime Validator
export {
  Validator,
  createValidator,
  validateType,
  assertValid,
  type ValidatorOptions,
  type ValidationResult,
} from './runtime/validator.js';

// Runtime Translator
export {
  Translator,
  createTranslator,
  createLoggingMiddleware,
  createHeaderMiddleware,
  createResponseTransformMiddleware,
  createErrorMiddleware,
  type TranslationContext,
  type TranslationResult,
  type TranslatorMiddleware,
  type BackendHandler,
  type TranslatorOptions,
  type RouteInfo,
} from './runtime/translator.js';

// REST Generator
export {
  RestGenerator,
  generateRestRoutes,
  generateRouteConfigs,
  type RouteConfig,
  type RestGeneratorOutput,
  type RestGeneratorOptions,
  type FastifyRouteSchema,
} from './generators/rest-generator.js';

// Gateway
export {
  createGateway,
  chameleonPlugin,
  type Gateway,
  type GatewayOptions,
  type ChameleonPluginOptions,
} from './server/gateway.js';

// ============================================================================
// Phase 4: Protobuf and gRPC
// ============================================================================

// Protobuf Parser
export {
  ProtobufParser,
  parseProtobufFile,
  parseProtobufString,
  type ProtobufParseOptions,
} from './parsers/protobuf.js';

// gRPC Generator
export {
  GrpcGenerator,
  generateGrpc,
  generateProtoFile,
  type GrpcGeneratorOptions,
  type GrpcGeneratorOutput,
  type GrpcServiceInfo,
  type GrpcMethodInfo,
} from './generators/grpc-generator.js';

// ============================================================================
// Phase 5: DataLoader and Stream Bridge
// ============================================================================

// DataLoader Auto-Injection
export {
  DataLoaderManager,
  RequestDataLoaderScope,
  detectBatchableEndpoints,
  createDataLoaderMiddleware,
  createDataLoaderManager,
  createDataLoaderContext,
  analyzeN1Patterns,
  type BatchableEndpoint,
  type DataLoaderOptions,
  type ManualBatchEndpoint,
  type BatchFunction,
  type DataLoaderStats,
} from './runtime/dataloader.js';

// Stream Bridge (gRPC Stream ↔ WebSocket/SSE)
export {
  SSEAdapter,
  WebSocketAdapter,
  StreamAsyncIterator,
  StreamBridgeManager,
  MemoryStreamSource,
  MemoryStreamSink,
  createStreamBridgeManager,
  createSSEAdapter,
  createWebSocketAdapter,
  createStreamAsyncIterator,
  type StreamMessage,
  type StreamEvent,
  type StreamStatus,
  type SSEBridgeOptions,
  type WebSocketBridgeOptions,
  type StreamBridgeOptions,
  type StreamBridgeHooks,
  type StreamConnectionInfo,
  type StreamSource,
  type StreamSink,
  type StreamBridgeStats,
} from './runtime/stream-bridge.js';

// ============================================================================
// Phase 6: Hot Reload, Admin, and GraphQL SDL Parser
// ============================================================================

// GraphQL SDL Parser
export {
  GraphQLSDLParser,
  parseGraphQLFile,
  parseGraphQLString,
  type GraphQLParseOptions,
} from './parsers/graphql.js';

// Schema Watcher
export {
  SchemaWatcher,
  createSchemaWatcher,
  detectSchemaFormat,
  type SchemaChangeType,
  type SchemaChangeEvent,
  type SchemaFormat,
  type SchemaWatcherOptions,
  type SchemaWatcherStats,
} from './watcher/schema-watcher.js';

// Hot Reload Manager
export {
  HotReloadManager,
  createHotReloadManager,
  type HotReloadOptions,
  type ReloadState,
  type HotReloadEvent,
  type HotReloadError,
  type ReloadHistoryEntry,
  type HotReloadStats,
} from './watcher/hot-reload.js';

// Admin API
export {
  adminPlugin,
  registerAdminAPI,
  type AdminOptions,
  type SchemaInfo,
  type ServiceInfo,
  type MethodInfo as AdminMethodInfo,
  type RouteInfo as AdminRouteInfo,
  type AdminStatsResponse,
} from './server/admin.js';
