/**
 * DataLoader Auto-Injection
 *
 * Automatically detects N+1 query patterns in IR schemas and injects
 * Facebook DataLoader for batch loading. Provides middleware integration
 * for the Chameleon gateway to optimize backend calls.
 *
 * Detection heuristics:
 * - Methods with single ID parameter returning a single object (detail endpoints)
 * - Corresponding list endpoints that return arrays of the same type
 * - Named ID parameters (e.g., petId, userId) matching path patterns
 */

import DataLoader from 'dataloader';
import type {
  IRSchema,
  IRService,
  IRMethod,
  IRType,
} from '../parsers/ir.js';
import {
  isObjectType,
  isArrayType,
  isPrimitiveType,
  getTypeName,
} from '../parsers/ir.js';
import type {
  TranslatorMiddleware,
  TranslationContext,
  TranslationResult,
  BackendHandler,
} from './translator.js';
import { RuntimeError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A detected batchable endpoint pattern
 */
export interface BatchableEndpoint {
  /** The detail method (e.g., GET /pets/{petId}) */
  detailMethod: IRMethod;
  /** The service containing the method */
  serviceName: string;
  /** The ID parameter name (e.g., 'petId') */
  idParam: string;
  /** The corresponding list method (if found) */
  listMethod?: IRMethod;
  /** The output type name */
  outputTypeName: string;
}

/**
 * Configuration for DataLoader behavior
 */
export interface DataLoaderOptions {
  /** Maximum batch size (default: 100) */
  maxBatchSize?: number;
  /** Whether to cache results within a single request (default: true) */
  cache?: boolean;
  /** Cache TTL in milliseconds for cross-request caching (default: 0, disabled) */
  cacheTTL?: number;
  /** Custom batch function override */
  customBatchFn?: Record<string, BatchFunction>;
  /** Whether to auto-detect batchable endpoints (default: true) */
  autoDetect?: boolean;
  /** Manually specify batchable endpoints */
  manualEndpoints?: ManualBatchEndpoint[];
}

/**
 * Manual batch endpoint configuration
 */
export interface ManualBatchEndpoint {
  /** Method name for the detail endpoint */
  detailMethodName: string;
  /** Service name */
  serviceName: string;
  /** ID parameter name */
  idParam: string;
  /** Optional list method name for batch resolution */
  listMethodName?: string;
}

/**
 * Batch function type for DataLoader
 */
export type BatchFunction = (
  keys: readonly string[]
) => Promise<unknown[]>;

/**
 * DataLoader registry entry
 */
interface LoaderEntry {
  /** The DataLoader instance */
  loader: DataLoader<string, unknown>;
  /** The batchable endpoint info */
  endpoint: BatchableEndpoint;
  /** Creation timestamp for TTL */
  createdAt: number;
}

/**
 * Statistics for DataLoader usage
 */
export interface DataLoaderStats {
  /** Total number of detected batchable endpoints */
  batchableEndpoints: number;
  /** Total DataLoader instances created */
  loadersCreated: number;
  /** Total batch calls made */
  batchCalls: number;
  /** Total individual loads served */
  individualLoads: number;
  /** Cache hit count */
  cacheHits: number;
  /** Average batch size */
  averageBatchSize: number;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<DataLoaderOptions> = {
  maxBatchSize: 100,
  cache: true,
  cacheTTL: 0,
  customBatchFn: {},
  autoDetect: true,
  manualEndpoints: [],
};

// ============================================================================
// N+1 Pattern Detection
// ============================================================================

/**
 * Detect batchable endpoints in an IR schema
 *
 * Heuristics:
 * 1. GET methods with a single path parameter (e.g., GET /pets/{petId})
 * 2. The parameter name ends with 'Id' or 'id' or is 'id'
 * 3. The output is an object type (not void/array/primitive)
 * 4. Optionally, a list endpoint exists (GET /pets) returning an array of the same type
 */
export function detectBatchableEndpoints(schema: IRSchema): BatchableEndpoint[] {
  const endpoints: BatchableEndpoint[] = [];

  for (const service of schema.services) {
    const detailMethods = findDetailMethods(service);
    const listMethods = findListMethods(service);

    for (const { method, idParam } of detailMethods) {
      const outputTypeName = getOutputTypeName(method.output);

      // Try to find a matching list method
      const matchingList = listMethods.find((lm) => {
        const listItemType = getListItemTypeName(lm.output);
        return listItemType !== null && listItemType === outputTypeName;
      });

      endpoints.push({
        detailMethod: method,
        serviceName: service.name,
        idParam,
        listMethod: matchingList,
        outputTypeName,
      });
    }
  }

  return endpoints;
}

/**
 * Find methods that look like detail/get-by-id endpoints
 */
function findDetailMethods(
  service: IRService
): Array<{ method: IRMethod; idParam: string }> {
  const results: Array<{ method: IRMethod; idParam: string }> = [];

  for (const method of service.methods) {
    // Must be GET method
    if (method.httpMethod !== 'GET') {
      continue;
    }

    // Must have path with parameters
    if (!method.path) {
      continue;
    }

    // Must return an object type
    if (!isObjectType(method.output)) {
      continue;
    }

    // Find ID parameter
    const idParam = findIdParameter(method);
    if (idParam) {
      results.push({ method, idParam });
    }
  }

  return results;
}

/**
 * Find methods that look like list endpoints
 */
function findListMethods(service: IRService): IRMethod[] {
  return service.methods.filter((method) => {
    // Must be GET method
    if (method.httpMethod !== 'GET') {
      return false;
    }

    // Must return an array type
    if (!isArrayType(method.output)) {
      return false;
    }

    // Array element should be an object
    if (!isObjectType(method.output.elementType)) {
      return false;
    }

    return true;
  });
}

/**
 * Find the ID parameter in a method
 */
function findIdParameter(method: IRMethod): string | null {
  // Check explicit parameters first
  if (method.parameters) {
    for (const param of method.parameters) {
      if (param.location === 'path' && isIdLikeParam(param.name)) {
        return param.name;
      }
    }
    // If only one path parameter, treat it as the ID
    const pathParams = method.parameters.filter((p) => p.location === 'path');
    if (pathParams.length === 1 && pathParams[0]) {
      return pathParams[0].name;
    }
  }

  // Check path pattern for {id} or {*Id} patterns
  if (method.path) {
    const matches = method.path.match(/\{(\w+)\}/g);
    if (matches && matches.length === 1 && matches[0]) {
      const paramName = matches[0].slice(1, -1);
      return paramName;
    }
  }

  // Check input type for ID-like fields
  if (isObjectType(method.input)) {
    for (const field of method.input.fields) {
      if (isIdLikeParam(field.name) && isPrimitiveType(field.type)) {
        return field.name;
      }
    }
    // Single field input is likely the ID
    if (method.input.fields.length === 1 && method.input.fields[0]) {
      return method.input.fields[0].name;
    }
  }

  return null;
}

/**
 * Check if a parameter name looks like an ID
 */
function isIdLikeParam(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'id' ||
    lower.endsWith('id') ||
    lower.endsWith('_id') ||
    lower === 'key' ||
    lower === 'slug'
  );
}

/**
 * Get the display name of an output type
 */
function getOutputTypeName(type: IRType): string {
  if (isObjectType(type) && type.name) {
    return type.name;
  }
  return getTypeName(type);
}

/**
 * Get the type name of list items
 */
function getListItemTypeName(type: IRType): string | null {
  if (isArrayType(type) && isObjectType(type.elementType) && type.elementType.name) {
    return type.elementType.name;
  }
  return null;
}

// ============================================================================
// DataLoader Manager
// ============================================================================

/**
 * Manages DataLoader instances for a schema
 */
export class DataLoaderManager {
  private options: Required<DataLoaderOptions>;
  private batchableEndpoints: BatchableEndpoint[] = [];
  private endpointMap: Map<string, BatchableEndpoint> = new Map();
  private globalLoaders: Map<string, LoaderEntry> = new Map();
  private stats: DataLoaderStats = {
    batchableEndpoints: 0,
    loadersCreated: 0,
    batchCalls: 0,
    individualLoads: 0,
    cacheHits: 0,
    averageBatchSize: 0,
  };
  private totalBatchItems = 0;

  constructor(
    private schema: IRSchema,
    private backendHandler: BackendHandler,
    options?: DataLoaderOptions
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.initialize();
  }

  /**
   * Initialize by detecting batchable endpoints
   */
  private initialize(): void {
    // Auto-detect batchable endpoints
    if (this.options.autoDetect) {
      this.batchableEndpoints = detectBatchableEndpoints(this.schema);
    }

    // Add manual endpoints
    for (const manual of this.options.manualEndpoints) {
      const service = this.schema.services.find(
        (s) => s.name === manual.serviceName
      );
      if (!service) {
        continue;
      }

      const detailMethod = service.methods.find(
        (m) => m.name === manual.detailMethodName
      );
      if (!detailMethod) {
        continue;
      }

      const listMethod = manual.listMethodName
        ? service.methods.find((m) => m.name === manual.listMethodName)
        : undefined;

      const endpoint: BatchableEndpoint = {
        detailMethod,
        serviceName: manual.serviceName,
        idParam: manual.idParam,
        listMethod,
        outputTypeName: getOutputTypeName(detailMethod.output),
      };

      // Avoid duplicates
      const key = this.getEndpointKey(endpoint);
      if (!this.endpointMap.has(key)) {
        this.batchableEndpoints.push(endpoint);
      }
    }

    // Build lookup map
    for (const endpoint of this.batchableEndpoints) {
      const key = this.getEndpointKey(endpoint);
      this.endpointMap.set(key, endpoint);
    }

    this.stats.batchableEndpoints = this.batchableEndpoints.length;
  }

  /**
   * Get a unique key for a batchable endpoint
   */
  private getEndpointKey(endpoint: BatchableEndpoint): string {
    return `${endpoint.serviceName}.${endpoint.detailMethod.name}`;
  }

  /**
   * Check if a method has a DataLoader available
   */
  isBatchable(methodName: string, serviceName?: string): boolean {
    if (serviceName) {
      return this.endpointMap.has(`${serviceName}.${methodName}`);
    }
    return Array.from(this.endpointMap.keys()).some(
      (k) => k.endsWith(`.${methodName}`)
    );
  }

  /**
   * Get or create a DataLoader for a method
   * Returns per-request scoped loader when cache=false or cacheTTL=0
   */
  getLoader(methodName: string, serviceName?: string): DataLoader<string, unknown> | null {
    const key = serviceName
      ? `${serviceName}.${methodName}`
      : Array.from(this.endpointMap.keys()).find((k) =>
          k.endsWith(`.${methodName}`)
        );

    if (!key) {
      return null;
    }

    const endpoint = this.endpointMap.get(key);
    if (!endpoint) {
      return null;
    }

    // Check global cache
    if (this.options.cacheTTL > 0) {
      const existing = this.globalLoaders.get(key);
      if (existing && Date.now() - existing.createdAt < this.options.cacheTTL) {
        return existing.loader;
      }
    }

    // Create new loader
    const loader = this.createLoader(endpoint);
    this.stats.loadersCreated++;

    if (this.options.cacheTTL > 0) {
      this.globalLoaders.set(key, {
        loader,
        endpoint,
        createdAt: Date.now(),
      });
    }

    return loader;
  }

  /**
   * Create a DataLoader for a batchable endpoint
   */
  private createLoader(endpoint: BatchableEndpoint): DataLoader<string, unknown> {
    const key = this.getEndpointKey(endpoint);

    // Check for custom batch function
    const customFn = this.options.customBatchFn[key];
    if (customFn) {
      return new DataLoader(
        async (keys: readonly string[]) => {
          this.stats.batchCalls++;
          this.stats.individualLoads += keys.length;
          this.totalBatchItems += keys.length;
          this.stats.averageBatchSize =
            this.totalBatchItems / this.stats.batchCalls;
          return customFn(keys);
        },
        {
          maxBatchSize: this.options.maxBatchSize,
          cache: this.options.cache,
        }
      );
    }

    // Default batch function: call the detail endpoint for each key
    const batchFn: BatchFunction = async (
      keys: readonly string[]
    ): Promise<unknown[]> => {
      this.stats.batchCalls++;
      this.stats.individualLoads += keys.length;
      this.totalBatchItems += keys.length;
      this.stats.averageBatchSize =
        this.totalBatchItems / this.stats.batchCalls;

      // Execute all detail calls in parallel
      const results = await Promise.allSettled(
        keys.map((id) => this.fetchSingle(endpoint, id))
      );

      return results.map((result) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        return new Error(
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        );
      });
    };

    return new DataLoader(batchFn, {
      maxBatchSize: this.options.maxBatchSize,
      cache: this.options.cache,
    });
  }

  /**
   * Fetch a single item by ID using the backend handler
   */
  private async fetchSingle(
    endpoint: BatchableEndpoint,
    id: string
  ): Promise<unknown> {
    const { detailMethod, serviceName, idParam } = endpoint;

    // Build a minimal translation context
    const ctx: TranslationContext = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      request: this.createMockRequest(detailMethod, idParam, id),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      reply: this.createMockReply(),
      pathParams: { [idParam]: id },
      queryParams: {},
      body: undefined,
      params: { [idParam]: id },
      method: detailMethod,
      serviceName,
      data: { __dataloader: true },
    };

    const result = await this.backendHandler(ctx);

    if (result.statusCode >= 400) {
      throw new RuntimeError(
        `Backend returned ${result.statusCode} for ${detailMethod.name} with ${idParam}=${id}`,
        detailMethod.name
      );
    }

    return result.body;
  }

  /**
   * Create a per-request loader scope
   * Each request gets its own set of DataLoaders with independent caches
   */
  createRequestScope(): RequestDataLoaderScope {
    return new RequestDataLoaderScope(this);
  }

  /**
   * Get all detected batchable endpoints
   */
  getBatchableEndpoints(): readonly BatchableEndpoint[] {
    return this.batchableEndpoints;
  }

  /**
   * Get DataLoader statistics
   */
  getStats(): DataLoaderStats {
    return { ...this.stats };
  }

  /**
   * Clear all cached loaders
   */
  clearCache(): void {
    this.globalLoaders.clear();
  }

  /**
   * Create a mock Fastify request for DataLoader calls
   */
  private createMockRequest(
    method: IRMethod,
    idParam: string,
    id: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    const path = method.path
      ? method.path.replace(`{${idParam}}`, id).replace(`:${idParam}`, id)
      : '/';

    return {
      method: method.httpMethod ?? 'GET',
      url: path,
      params: { [idParam]: id },
      query: {},
      body: undefined,
      headers: {},
    };
  }

  /**
   * Create a mock Fastify reply
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createMockReply(): any {
    const noop = (): void => { /* empty */ };
    return {
      status: () => ({ send: noop }),
      send: noop,
    };
  }
}

// ============================================================================
// Per-Request DataLoader Scope
// ============================================================================

/**
 * Per-request DataLoader scope
 * Provides request-scoped caching to prevent N+1 within a single request
 */
export class RequestDataLoaderScope {
  private loaders: Map<string, DataLoader<string, unknown>> = new Map();

  constructor(private manager: DataLoaderManager) {}

  /**
   * Load a single item by its ID
   */
  async load(
    methodName: string,
    id: string,
    serviceName?: string
  ): Promise<unknown> {
    const loader = this.getOrCreateLoader(methodName, serviceName);
    if (!loader) {
      throw new RuntimeError(
        `No DataLoader available for method ${methodName}`,
        methodName
      );
    }
    return loader.load(id);
  }

  /**
   * Load multiple items by their IDs
   */
  async loadMany(
    methodName: string,
    ids: string[],
    serviceName?: string
  ): Promise<unknown[]> {
    const loader = this.getOrCreateLoader(methodName, serviceName);
    if (!loader) {
      throw new RuntimeError(
        `No DataLoader available for method ${methodName}`,
        methodName
      );
    }
    return loader.loadMany(ids);
  }

  /**
   * Prime the cache with a known value
   */
  prime(
    methodName: string,
    id: string,
    value: unknown,
    serviceName?: string
  ): void {
    const loader = this.getOrCreateLoader(methodName, serviceName);
    if (loader) {
      loader.prime(id, value);
    }
  }

  /**
   * Clear a specific item from the cache
   */
  clear(methodName: string, id: string, serviceName?: string): void {
    const loader = this.getOrCreateLoader(methodName, serviceName);
    if (loader) {
      loader.clear(id);
    }
  }

  /**
   * Clear all cached items for all loaders
   */
  clearAll(): void {
    for (const loader of this.loaders.values()) {
      loader.clearAll();
    }
  }

  /**
   * Get or create a loader for the given method
   */
  private getOrCreateLoader(
    methodName: string,
    serviceName?: string
  ): DataLoader<string, unknown> | null {
    const key = serviceName ? `${serviceName}.${methodName}` : methodName;

    const existing = this.loaders.get(key);
    if (existing) {
      return existing;
    }

    const loader = this.manager.getLoader(methodName, serviceName);
    if (!loader) {
      return null;
    }

    this.loaders.set(key, loader);
    return loader;
  }
}

// ============================================================================
// DataLoader Middleware
// ============================================================================

/**
 * Create a DataLoader middleware for the translation pipeline
 *
 * This middleware intercepts detail endpoint calls and routes them through
 * DataLoader for automatic batching within the same request cycle.
 */
export function createDataLoaderMiddleware(
  manager: DataLoaderManager
): TranslatorMiddleware {
  return async (
    ctx: TranslationContext,
    next: () => Promise<TranslationResult>
  ): Promise<TranslationResult> => {
    // Skip if this call is from DataLoader itself (prevent infinite loop)
    if (ctx.data.__dataloader) {
      return next();
    }

    // Check if this method is batchable
    if (!manager.isBatchable(ctx.method.name, ctx.serviceName)) {
      return next();
    }

    // Get the batchable endpoint info
    const endpoints = manager.getBatchableEndpoints();
    const endpoint = endpoints.find(
      (ep) =>
        ep.detailMethod.name === ctx.method.name &&
        ep.serviceName === ctx.serviceName
    );

    if (!endpoint) {
      return next();
    }

    // Get the ID from the request
    const id = ctx.pathParams[endpoint.idParam] ?? ctx.params[endpoint.idParam];
    if (id === undefined || id === null) {
      return next();
    }

    // Get or create request-scoped loader
    let scope = ctx.data.__dataloaderScope as RequestDataLoaderScope | undefined;
    if (!scope) {
      scope = manager.createRequestScope();
      ctx.data.__dataloaderScope = scope;
    }

    try {
      const result = await scope.load(
        ctx.method.name,
        String(id),
        ctx.serviceName
      );
      return {
        statusCode: 200,
        body: result,
      };
    } catch (error) {
      if (error instanceof Error) {
        return {
          statusCode: 500,
          body: { error: error.message },
        };
      }
      throw error;
    }
  };
}

/**
 * Create a GraphQL context enricher that adds DataLoader scope
 *
 * Use this to inject DataLoader scope into GraphQL resolver context,
 * enabling per-request batching across multiple resolver calls.
 */
export function createDataLoaderContext(
  manager: DataLoaderManager
): () => { dataLoaderScope: RequestDataLoaderScope } {
  return () => ({
    dataLoaderScope: manager.createRequestScope(),
  });
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a DataLoaderManager instance
 */
export function createDataLoaderManager(
  schema: IRSchema,
  backendHandler: BackendHandler,
  options?: DataLoaderOptions
): DataLoaderManager {
  return new DataLoaderManager(schema, backendHandler, options);
}

/**
 * Analyze a schema for N+1 patterns and return a report
 */
export function analyzeN1Patterns(
  schema: IRSchema
): {
  endpoints: BatchableEndpoint[];
  summary: string;
} {
  const endpoints = detectBatchableEndpoints(schema);

  const lines = [
    `Found ${endpoints.length} potential N+1 pattern(s):`,
    '',
  ];

  for (const ep of endpoints) {
    const detail = `${ep.detailMethod.httpMethod ?? 'GET'} ${ep.detailMethod.path ?? ep.detailMethod.name}`;
    const list = ep.listMethod
      ? `${ep.listMethod.httpMethod ?? 'GET'} ${ep.listMethod.path ?? ep.listMethod.name}`
      : '(no matching list endpoint)';

    lines.push(`  📦 ${ep.outputTypeName}`);
    lines.push(`     Detail: ${detail} (param: ${ep.idParam})`);
    lines.push(`     List:   ${list}`);
    lines.push('');
  }

  if (endpoints.length === 0) {
    lines.push('  No N+1 patterns detected.');
  }

  return {
    endpoints,
    summary: lines.join('\n'),
  };
}
