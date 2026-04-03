/**
 * Runtime Translator
 *
 * Provides real-time request/response translation between different API protocols.
 * Supports REST → GraphQL translation with middleware pipeline architecture.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type {
  IRSchema,
  IRMethod,
  HttpMethod,
} from '../parsers/ir.js';
import { isVoidType } from '../parsers/ir.js';
import type { OperationInfo } from '../generators/graphql-generator.js';
import { Validator, createValidator } from './validator.js';
import { RuntimeError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Request context passed through the translation pipeline
 */
export interface TranslationContext {
  /** Original HTTP request */
  request: FastifyRequest;
  /** HTTP response object */
  reply: FastifyReply;
  /** Parsed path parameters */
  pathParams: Record<string, string>;
  /** Parsed query parameters */
  queryParams: Record<string, string | string[] | undefined>;
  /** Parsed request body */
  body: unknown;
  /** Combined parameters (path + query + body) */
  params: Record<string, unknown>;
  /** Target method info */
  method: IRMethod;
  /** Target service name */
  serviceName: string;
  /** Custom context data */
  data: Record<string, unknown>;
}

/**
 * Translation result
 */
export interface TranslationResult {
  /** HTTP status code */
  statusCode: number;
  /** Response body */
  body: unknown;
  /** Response headers */
  headers?: Record<string, string>;
}

/**
 * Middleware function type
 */
export type TranslatorMiddleware = (
  ctx: TranslationContext,
  next: () => Promise<TranslationResult>
) => Promise<TranslationResult>;

/**
 * Backend handler function type
 */
export type BackendHandler = (
  ctx: TranslationContext
) => Promise<TranslationResult>;

/**
 * Options for the translator
 */
export interface TranslatorOptions {
  /** Base URL for the REST backend */
  backendBaseUrl?: string;
  /** Default timeout in milliseconds */
  timeout?: number;
  /** Custom headers to forward */
  forwardHeaders?: string[];
  /** Whether to validate requests */
  validateRequests?: boolean;
  /** Whether to validate responses */
  validateResponses?: boolean;
  /** Custom backend handler (overrides default fetch) */
  backendHandler?: BackendHandler;
}

/**
 * Route registration info
 */
export interface RouteInfo {
  /** HTTP method */
  method: HttpMethod;
  /** URL path pattern */
  path: string;
  /** Target IR method */
  irMethod: IRMethod;
  /** Service name */
  serviceName: string;
  /** Route handler */
  handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<TranslatorOptions> = {
  backendBaseUrl: 'http://localhost:3001',
  timeout: 30000,
  forwardHeaders: ['authorization', 'x-request-id', 'x-correlation-id'],
  validateRequests: true,
  validateResponses: false,
  backendHandler: undefined as unknown as BackendHandler,
};

/**
 * GraphQL resolver function type
 */
type GraphQLResolverFn = (
  parent: unknown,
  args: Record<string, unknown>,
  context: unknown,
  info: unknown
) => Promise<unknown>;

// ============================================================================
// Translator Class
// ============================================================================

/**
 * Runtime translator for protocol conversion
 */
export class Translator {
  private options: Required<TranslatorOptions>;
  private validator: Validator;
  private middlewares: TranslatorMiddleware[] = [];
  private operationMap: Map<string, OperationInfo> = new Map();
  private methodsByPath: Map<string, Map<HttpMethod, IRMethod>> = new Map();
  private serviceMethodMap: Map<string, IRMethod> = new Map();

  constructor(
    private schema: IRSchema,
    options?: TranslatorOptions
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.validator = createValidator(schema);
    this.buildMethodMaps();
  }

  /**
   * Build internal method lookup maps
   */
  private buildMethodMaps(): void {
    for (const service of this.schema.services) {
      for (const method of service.methods) {
        // Map by operation name
        this.serviceMethodMap.set(
          `${service.name}.${method.name}`,
          method
        );
        this.serviceMethodMap.set(method.name, method);

        // Map by path + HTTP method
        if (method.path && method.httpMethod) {
          const normalizedPath = this.normalizePath(method.path);
          if (!this.methodsByPath.has(normalizedPath)) {
            this.methodsByPath.set(normalizedPath, new Map());
          }
          this.methodsByPath.get(normalizedPath)!.set(
            method.httpMethod,
            method
          );
        }

        // Add to operation map
        this.operationMap.set(method.name, {
          method,
          serviceName: service.name,
          operationType:
            method.httpMethod === 'GET' || method.httpMethod === 'HEAD'
              ? 'Query'
              : 'Mutation',
        });
      }
    }
  }

  /**
   * Normalize path for consistent matching
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\{([^}]+)\}/g, ':$1') // Convert {param} to :param
      .replace(/\/+$/, ''); // Remove trailing slashes
  }

  /**
   * Add a middleware to the pipeline
   */
  use(middleware: TranslatorMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Set the operation map from GraphQL generator
   */
  setOperationMap(opMap: Map<string, OperationInfo>): void {
    this.operationMap = opMap;
  }

  /**
   * Get method by operation name
   */
  getMethodByName(name: string): { method: IRMethod; serviceName: string } | undefined {
    const method = this.serviceMethodMap.get(name);
    if (method) {
      // Find service name
      for (const service of this.schema.services) {
        if (service.methods.includes(method)) {
          return { method, serviceName: service.name };
        }
      }
    }
    return undefined;
  }

  /**
   * Get method by path and HTTP method
   */
  getMethodByPath(
    path: string,
    httpMethod: HttpMethod
  ): IRMethod | undefined {
    const normalizedPath = this.normalizePath(path);
    const methodMap = this.methodsByPath.get(normalizedPath);
    return methodMap?.get(httpMethod);
  }

  /**
   * Translate a REST request to backend call
   */
  async translateRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    method: IRMethod,
    serviceName: string
  ): Promise<TranslationResult> {
    // Build translation context
    const ctx = this.buildContext(request, reply, method, serviceName);

    // Validate request if enabled
    if (this.options.validateRequests) {
      this.validateRequest(ctx);
    }

    // Run middleware pipeline
    const result = await this.runPipeline(ctx);

    return result;
  }

  /**
   * Build translation context from request
   */
  private buildContext(
    request: FastifyRequest,
    reply: FastifyReply,
    method: IRMethod,
    serviceName: string
  ): TranslationContext {
    const pathParams = (request.params || {}) as Record<string, string>;
    const queryParams = (request.query || {}) as Record<string, string | string[] | undefined>;
    const body = request.body;

    // Combine all parameters
    const params: Record<string, unknown> = {
      ...pathParams,
      ...queryParams,
    };

    // Add body params
    if (body && typeof body === 'object') {
      Object.assign(params, body);
    }

    return {
      request,
      reply,
      pathParams,
      queryParams,
      body,
      params,
      method,
      serviceName,
      data: {},
    };
  }

  /**
   * Validate request parameters
   */
  private validateRequest(ctx: TranslationContext): void {
    const { method, pathParams, queryParams, body } = ctx;

    // Validate path parameters
    const pathResult = this.validator.validatePathParams(pathParams, method);
    if (!pathResult.success) {
      throw new RuntimeError(
        `Path parameter validation failed: ${JSON.stringify(pathResult.errors)}`,
        method.name
      );
    }

    // Validate query parameters
    const queryResult = this.validator.validateQueryParams(queryParams, method);
    if (!queryResult.success) {
      throw new RuntimeError(
        `Query parameter validation failed: ${JSON.stringify(queryResult.errors)}`,
        method.name
      );
    }

    // Validate body
    if (body !== undefined && !isVoidType(method.input)) {
      const bodyResult = this.validator.validateBody(body, method);
      if (!bodyResult.success) {
        throw new RuntimeError(
          `Request body validation failed: ${JSON.stringify(bodyResult.errors)}`,
          method.name
        );
      }
    }
  }

  /**
   * Run the middleware pipeline
   */
  private async runPipeline(ctx: TranslationContext): Promise<TranslationResult> {
    let index = 0;

    const next = async (): Promise<TranslationResult> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        if (middleware) {
          return middleware(ctx, next);
        }
      }
      // End of middleware chain, call backend
      return this.callBackend(ctx);
    };

    return next();
  }

  /**
   * Call the backend service
   */
  private async callBackend(ctx: TranslationContext): Promise<TranslationResult> {
    // Use custom handler if provided
    if (this.options.backendHandler) {
      return this.options.backendHandler(ctx);
    }

    // Default: forward to REST backend
    return this.forwardToRestBackend(ctx);
  }

  /**
   * Forward request to REST backend
   */
  private async forwardToRestBackend(
    ctx: TranslationContext
  ): Promise<TranslationResult> {
    const { method, pathParams, queryParams, body, request } = ctx;

    if (!method.path || !method.httpMethod) {
      throw new RuntimeError(
        `Method ${method.name} has no HTTP path or method defined`,
        method.name
      );
    }

    // Build URL
    let url = `${this.options.backendBaseUrl}${method.path}`;

    // Replace path parameters
    for (const [key, value] of Object.entries(pathParams)) {
      url = url.replace(`{${key}}`, encodeURIComponent(value));
      url = url.replace(`:${key}`, encodeURIComponent(value));
    }

    // Add query parameters
    const queryParts: string[] = [];
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const v of value) {
            queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
          }
        } else {
          queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
      }
    }
    if (queryParts.length > 0) {
      url += `?${queryParts.join('&')}`;
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Forward allowed headers
    for (const headerName of this.options.forwardHeaders) {
      const headerValue = request.headers[headerName.toLowerCase()];
      if (headerValue) {
        headers[headerName] = Array.isArray(headerValue)
          ? (headerValue[0] ?? '')
          : headerValue;
      }
    }

    // Make request
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.options.timeout
    );

    try {
      const response = await fetch(url, {
        method: method.httpMethod,
        headers,
        body: body && method.httpMethod !== 'GET' && method.httpMethod !== 'HEAD'
          ? JSON.stringify(body)
          : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Parse response
      let responseBody: unknown;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        responseBody = await response.json();
      } else {
        const text = await response.text();
        try {
          responseBody = JSON.parse(text);
        } catch {
          responseBody = text;
        }
      }

      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        statusCode: response.status,
        body: responseBody,
        headers: responseHeaders,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RuntimeError(
          `Request timeout after ${this.options.timeout}ms`,
          method.name
        );
      }
      throw new RuntimeError(
        `Backend request failed: ${error instanceof Error ? error.message : String(error)}`,
        method.name,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create GraphQL resolvers that use the translator
   */
  createGraphQLResolvers(): {
    Query?: Record<string, GraphQLResolverFn>;
    Mutation?: Record<string, GraphQLResolverFn>;
  } {
    const resolvers: {
      Query?: Record<string, GraphQLResolverFn>;
      Mutation?: Record<string, GraphQLResolverFn>;
    } = {};

    const queryResolvers: Record<string, GraphQLResolverFn> = {};
    const mutationResolvers: Record<string, GraphQLResolverFn> = {};

    for (const [opName, opInfo] of this.operationMap) {
      const resolver = this.createResolverForMethod(opInfo.method, opInfo.serviceName);

      if (opInfo.operationType === 'Query') {
        queryResolvers[opName] = resolver;
      } else {
        mutationResolvers[opName] = resolver;
      }
    }

    if (Object.keys(queryResolvers).length > 0) {
      resolvers.Query = queryResolvers;
    }
    if (Object.keys(mutationResolvers).length > 0) {
      resolvers.Mutation = mutationResolvers;
    }

    return resolvers;
  }

  /**
   * Create a resolver function for a method
   */
  private createResolverForMethod(
    method: IRMethod,
    serviceName: string
  ): GraphQLResolverFn {
    return async (
      _parent: unknown,
      args: Record<string, unknown>,
      context: unknown,
      _info: unknown
    ): Promise<unknown> => {
      // Extract params from args
      const params = { ...args };

      // Handle input wrapper
      if (args.input && typeof args.input === 'object') {
        Object.assign(params, args.input);
      }

      // Build a minimal context for translation
      const gqlContext = context as { request?: FastifyRequest; reply?: FastifyReply } | undefined;
      const mockRequest = gqlContext?.request ?? this.createMockRequest(params, method);
      const mockReply = gqlContext?.reply ?? this.createMockReply();

      const translationCtx: TranslationContext = {
        request: mockRequest,
        reply: mockReply,
        pathParams: this.extractPathParams(params, method),
        queryParams: this.extractQueryParams(params, method),
        body: this.extractBody(params, method),
        params,
        method,
        serviceName,
        data: {},
      };

      // Validate if enabled
      if (this.options.validateRequests) {
        this.validateRequest(translationCtx);
      }

      // Execute pipeline
      const result = await this.runPipeline(translationCtx);

      // Check for errors
      if (result.statusCode >= 400) {
        throw new RuntimeError(
          `Backend returned error: ${JSON.stringify(result.body)}`,
          method.name
        );
      }

      return result.body;
    };
  }

  /**
   * Extract path parameters from args based on method definition
   */
  private extractPathParams(
    args: Record<string, unknown>,
    method: IRMethod
  ): Record<string, string> {
    const pathParams: Record<string, string> = {};

    if (method.parameters) {
      for (const param of method.parameters) {
        if (param.location === 'path' && args[param.name] !== undefined) {
          pathParams[param.name] = String(args[param.name]);
        }
      }
    }

    return pathParams;
  }

  /**
   * Extract query parameters from args based on method definition
   */
  private extractQueryParams(
    args: Record<string, unknown>,
    method: IRMethod
  ): Record<string, string | string[] | undefined> {
    const queryParams: Record<string, string | string[] | undefined> = {};

    if (method.parameters) {
      for (const param of method.parameters) {
        if (param.location === 'query' && args[param.name] !== undefined) {
          const value = args[param.name];
          if (Array.isArray(value)) {
            queryParams[param.name] = value.map(String);
          } else {
            queryParams[param.name] = String(value);
          }
        }
      }
    }

    return queryParams;
  }

  /**
   * Extract body from args based on method definition
   */
  private extractBody(
    args: Record<string, unknown>,
    method: IRMethod
  ): unknown {
    // Check for explicit input parameter
    if (args.input !== undefined) {
      return args.input;
    }

    // Check for body parameters
    if (method.parameters) {
      const bodyParams = method.parameters.filter((p) => p.location === 'body');
      if (bodyParams.length > 0) {
        const body: Record<string, unknown> = {};
        for (const param of bodyParams) {
          if (args[param.name] !== undefined) {
            body[param.name] = args[param.name];
          }
        }
        return Object.keys(body).length > 0 ? body : undefined;
      }
    }

    // For mutations, remaining args might be the body
    if (method.httpMethod && method.httpMethod !== 'GET' && method.httpMethod !== 'HEAD') {
      const usedParams = new Set<string>();
      if (method.parameters) {
        for (const param of method.parameters) {
          if (param.location !== 'body') {
            usedParams.add(param.name);
          }
        }
      }

      const bodyArgs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(args)) {
        if (!usedParams.has(key) && key !== 'input') {
          bodyArgs[key] = value;
        }
      }

      return Object.keys(bodyArgs).length > 0 ? bodyArgs : undefined;
    }

    return undefined;
  }

  /**
   * Create a mock Fastify request for GraphQL resolvers
   */
  private createMockRequest(
    params: Record<string, unknown>,
    method: IRMethod
  ): FastifyRequest {
    return {
      params: this.extractPathParams(params, method),
      query: this.extractQueryParams(params, method),
      body: this.extractBody(params, method),
      headers: {},
      method: method.httpMethod ?? 'GET',
      url: method.path ?? '/',
    } as unknown as FastifyRequest;
  }

  /**
   * Create a mock Fastify reply for GraphQL resolvers
   */
  private createMockReply(): FastifyReply {
    const noop = (): void => { /* empty */ };
    return {
      status: (): { send: () => void } => ({ send: noop }),
      send: noop,
    } as unknown as FastifyReply;
  }

  /**
   * Generate Fastify route handlers
   */
  generateRoutes(): RouteInfo[] {
    const routes: RouteInfo[] = [];

    for (const service of this.schema.services) {
      for (const method of service.methods) {
        if (method.path && method.httpMethod) {
          routes.push({
            method: method.httpMethod,
            path: this.normalizePath(method.path),
            irMethod: method,
            serviceName: service.name,
            handler: this.createRouteHandler(method, service.name),
          });
        }
      }
    }

    return routes;
  }

  /**
   * Create a route handler for a method
   */
  private createRouteHandler(
    method: IRMethod,
    serviceName: string
  ): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        const result = await this.translateRequest(req, reply, method, serviceName);
        void reply.status(result.statusCode);
        if (result.headers) {
          for (const [key, value] of Object.entries(result.headers)) {
            // Skip hop-by-hop headers
            if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
              void reply.header(key, value);
            }
          }
        }
        await reply.send(result.body);
      } catch (error) {
        if (error instanceof RuntimeError) {
          void reply.status(500);
          await reply.send({
            error: error.message,
            operation: error.operation,
          });
          return;
        }
        throw error;
      }
    };
  }
}

// ============================================================================
// Middleware Factories
// ============================================================================

/**
 * Create a logging middleware
 */
export function createLoggingMiddleware(
  logger: { info: (msg: string, data?: object) => void } = console
): TranslatorMiddleware {
  return async (ctx, next) => {
    const start = Date.now();
    logger.info(`[Translator] ${ctx.method.httpMethod} ${ctx.method.path}`, {
      method: ctx.method.name,
      service: ctx.serviceName,
    });

    const result = await next();

    const duration = Date.now() - start;
    logger.info(`[Translator] Response ${result.statusCode} in ${duration}ms`, {
      method: ctx.method.name,
      statusCode: result.statusCode,
      duration,
    });

    return result;
  };
}

/**
 * Create a header injection middleware
 */
export function createHeaderMiddleware(
  headers: Record<string, string>
): TranslatorMiddleware {
  return async (ctx, next) => {
    // Add headers to context for backend calls
    ctx.data.additionalHeaders = {
      ...(ctx.data.additionalHeaders as Record<string, string> | undefined),
      ...headers,
    };
    return next();
  };
}

/**
 * Create a response transformation middleware
 */
export function createResponseTransformMiddleware(
  transform: (body: unknown, ctx: TranslationContext) => unknown
): TranslatorMiddleware {
  return async (ctx, next) => {
    const result = await next();
    return {
      ...result,
      body: transform(result.body, ctx),
    };
  };
}

/**
 * Create error handling middleware
 */
export function createErrorMiddleware(): TranslatorMiddleware {
  return async (_ctx, next) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof RuntimeError) {
        return {
          statusCode: 500,
          body: {
            error: error.message,
            code: error.code,
            operation: error.operation,
          },
        };
      }
      return {
        statusCode: 500,
        body: {
          error: error instanceof Error ? error.message : 'Unknown error',
          code: 'INTERNAL_ERROR',
        },
      };
    }
  };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a translator instance
 */
export function createTranslator(
  schema: IRSchema,
  options?: TranslatorOptions
): Translator {
  return new Translator(schema, options);
}
