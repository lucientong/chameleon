/**
 * Chameleon Gateway
 *
 * Fastify-based unified gateway that exposes REST APIs as GraphQL endpoints.
 * Supports both direct REST passthrough and GraphQL translation.
 */

import Fastify from 'fastify';
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyPluginOptions,
} from 'fastify';
import fastifyCors from '@fastify/cors';
import fp from 'fastify-plugin';
import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import type { IRSchema } from '../parsers/ir.js';
import {
  generateGraphQL,
  type GraphQLGeneratorOutput,
} from '../generators/graphql-generator.js';
import {
  Translator,
  createTranslator,
  createLoggingMiddleware,
  createErrorMiddleware,
  type TranslatorOptions,
} from '../runtime/translator.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Gateway configuration options
 */
export interface GatewayOptions {
  /** Server port */
  port?: number;
  /** Server host */
  host?: string;
  /** Base URL for the REST backend to translate */
  backendBaseUrl?: string;
  /** Enable GraphQL endpoint */
  enableGraphQL?: boolean;
  /** GraphQL endpoint path */
  graphqlPath?: string;
  /** Enable REST proxy endpoint */
  enableRestProxy?: boolean;
  /** REST proxy base path */
  restProxyPath?: string;
  /** Enable request logging */
  enableLogging?: boolean;
  /** Custom Fastify options */
  fastifyOptions?: Record<string, unknown>;
  /** Translator options */
  translatorOptions?: TranslatorOptions;
  /** CORS configuration */
  cors?: {
    origin?: string | string[] | boolean;
    methods?: string[];
    allowedHeaders?: string[];
    credentials?: boolean;
  };
  /** Health check endpoint */
  healthCheckPath?: string;
}

/**
 * Gateway instance interface
 */
export interface Gateway {
  /** Fastify instance */
  app: FastifyInstance;
  /** Translator instance */
  translator: Translator;
  /** Generated GraphQL output */
  graphqlOutput?: GraphQLGeneratorOutput;
  /** Start the gateway */
  start(): Promise<void>;
  /** Stop the gateway */
  stop(): Promise<void>;
  /** Get the server address */
  getAddress(): string | null;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS = {
  port: 4000,
  host: '0.0.0.0',
  backendBaseUrl: 'http://localhost:3000',
  enableGraphQL: true,
  graphqlPath: '/graphql',
  enableRestProxy: true,
  restProxyPath: '/api',
  enableLogging: true,
  fastifyOptions: {},
  translatorOptions: {},
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
  },
  healthCheckPath: '/health',
} as const;

// ============================================================================
// Gateway Factory
// ============================================================================

/**
 * Create a Chameleon gateway instance
 */
export async function createGateway(
  schema: IRSchema,
  options?: GatewayOptions
): Promise<Gateway> {
  const opts = {
    port: options?.port ?? DEFAULT_OPTIONS.port,
    host: options?.host ?? DEFAULT_OPTIONS.host,
    backendBaseUrl: options?.backendBaseUrl ?? DEFAULT_OPTIONS.backendBaseUrl,
    enableGraphQL: options?.enableGraphQL ?? DEFAULT_OPTIONS.enableGraphQL,
    graphqlPath: options?.graphqlPath ?? DEFAULT_OPTIONS.graphqlPath,
    enableRestProxy: options?.enableRestProxy ?? DEFAULT_OPTIONS.enableRestProxy,
    restProxyPath: options?.restProxyPath ?? DEFAULT_OPTIONS.restProxyPath,
    enableLogging: options?.enableLogging ?? DEFAULT_OPTIONS.enableLogging,
    fastifyOptions: options?.fastifyOptions ?? DEFAULT_OPTIONS.fastifyOptions,
    translatorOptions: options?.translatorOptions ?? DEFAULT_OPTIONS.translatorOptions,
    cors: options?.cors ?? DEFAULT_OPTIONS.cors,
    healthCheckPath: options?.healthCheckPath ?? DEFAULT_OPTIONS.healthCheckPath,
  };

  // Create Fastify instance
  const app = Fastify({
    logger: opts.enableLogging,
  });

  // Create translator
  const translator = createTranslator(schema, {
    ...opts.translatorOptions,
    backendBaseUrl: opts.backendBaseUrl,
  });

  // Add logging middleware if enabled
  if (opts.enableLogging) {
    translator.use(createLoggingMiddleware(app.log));
  }

  // Add error handling middleware
  translator.use(createErrorMiddleware());

  // Setup CORS
  if (opts.cors) {
    /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
    await app.register(fastifyCors as any, {
      origin: opts.cors.origin,
      methods: opts.cors.methods,
      allowedHeaders: opts.cors.allowedHeaders,
      credentials: opts.cors.credentials,
    });
    /* eslint-enable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
  }

  // Variables to hold GraphQL setup
  let graphqlOutput: GraphQLGeneratorOutput | undefined;

  // Setup GraphQL if enabled
  if (opts.enableGraphQL) {
    graphqlOutput = generateGraphQL(schema);

    // Set operation map for translator
    translator.setOperationMap(graphqlOutput.operationMap);

    // Create executable schema with translator resolvers
    const translatorResolvers = translator.createGraphQLResolvers();
    const executableSchema = makeExecutableSchema({
      typeDefs: graphqlOutput.typeDefs,
      resolvers: translatorResolvers,
    });

    // Create Yoga instance
    const yoga = createYoga({
      schema: executableSchema,
      graphqlEndpoint: opts.graphqlPath,
      logging: opts.enableLogging,
    });

    // Register GraphQL endpoint
    app.route({
      url: opts.graphqlPath,
      method: ['GET', 'POST', 'OPTIONS'],
      handler: async (req, reply) => {
        // Create a web Request from Fastify request
        const request = createWebRequest(req);

        // Handle the request with Yoga
        const response = await yoga.handleRequest(request, {});

        // Copy response headers
        response.headers.forEach((value: string, key: string) => {
          void reply.header(key, value);
        });

        void reply.status(response.status);

        // Send response body
        if (response.body) {
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let done = false;

          while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) {
              chunks.push(result.value);
            }
          }

          const body = Buffer.concat(chunks);
          return reply.send(body);
        } else {
          return reply.send();
        }
      },
    });

    app.log.info(`GraphQL endpoint registered at ${opts.graphqlPath}`);
  }

  // Setup REST proxy if enabled
  if (opts.enableRestProxy) {
    const routes = translator.generateRoutes();

    for (const route of routes) {
      const proxyUrl = `${opts.restProxyPath}${route.path}`;

      app.route({
        method: route.method,
        url: proxyUrl,
        handler: route.handler,
      });

      app.log.info(`REST proxy route: ${route.method} ${proxyUrl} -> ${route.irMethod.name}`);
    }
  }

  // Health check endpoint
  if (opts.healthCheckPath) {
    app.get(opts.healthCheckPath, () => ({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      schema: {
        sourceType: schema.sourceType,
        services: schema.services.length,
        methods: schema.services.reduce((acc, s) => acc + s.methods.length, 0),
      },
    }));
  }

  // Schema introspection endpoint
  app.get('/_schema', () => ({
    sourceType: schema.sourceType,
    sourceVersion: schema.sourceVersion,
    services: schema.services.map((s) => ({
      name: s.name,
      description: s.description,
      methods: s.methods.map((m) => ({
        name: m.name,
        description: m.description,
        httpMethod: m.httpMethod,
        path: m.path,
        deprecated: m.deprecated,
      })),
    })),
  }));

  // GraphQL SDL endpoint (if GraphQL enabled)
  if (opts.enableGraphQL && graphqlOutput) {
    const sdl = graphqlOutput.typeDefs;
    app.get('/_graphql/sdl', () => ({
      typeDefs: sdl,
    }));
  }

  // Create gateway interface
  const gateway: Gateway = {
    app,
    translator,
    graphqlOutput,

    async start() {
      await app.listen({ port: opts.port, host: opts.host });
      app.log.info(`Chameleon gateway started at http://${opts.host}:${opts.port}`);
      if (opts.enableGraphQL) {
        app.log.info(`GraphQL endpoint: http://${opts.host}:${opts.port}${opts.graphqlPath}`);
      }
      if (opts.enableRestProxy) {
        app.log.info(`REST proxy: http://${opts.host}:${opts.port}${opts.restProxyPath}`);
      }
    },

    async stop() {
      await app.close();
      app.log.info('Chameleon gateway stopped');
    },

    getAddress() {
      const addresses = app.addresses();
      if (addresses.length > 0) {
        const addr = addresses[0];
        if (addr) {
          return `http://${addr.address}:${addr.port}`;
        }
      }
      return null;
    },
  };

  return gateway;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a Web API Request from Fastify request
 */
function createWebRequest(req: FastifyRequest): Request {
  // Build URL
  const protocol = req.protocol || 'http';
  const host = req.hostname || 'localhost';
  const url = `${protocol}://${host}${req.url}`;

  // Build headers
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v);
        }
      } else {
        headers.set(key, value);
      }
    }
  }

  // Build request init
  const init: RequestInit = {
    method: req.method,
    headers,
  };

  // Add body for POST/PUT/PATCH
  if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
    init.body = JSON.stringify(req.body);
  }

  return new Request(url, init);
}

// ============================================================================
// Standalone Plugin
// ============================================================================

/**
 * Fastify plugin for Chameleon gateway
 */
export interface ChameleonPluginOptions extends FastifyPluginOptions {
  /** IR Schema */
  schema: IRSchema;
  /** Gateway options */
  gatewayOptions?: Omit<GatewayOptions, 'port' | 'host' | 'fastifyOptions'>;
}

/**
 * Internal plugin implementation
 */
async function chameleonPluginImpl(
  fastify: FastifyInstance,
  options: ChameleonPluginOptions
): Promise<void> {
  const { schema, gatewayOptions = {} } = options;

  // Create translator
  const translator = createTranslator(schema, {
    ...gatewayOptions.translatorOptions,
    backendBaseUrl: gatewayOptions.backendBaseUrl ?? DEFAULT_OPTIONS.backendBaseUrl,
  });

  // Add error middleware
  translator.use(createErrorMiddleware());

  // Setup GraphQL if enabled
  if (gatewayOptions.enableGraphQL !== false) {
    const graphqlPath = gatewayOptions.graphqlPath ?? DEFAULT_OPTIONS.graphqlPath;
    const graphqlOutput = generateGraphQL(schema);

    translator.setOperationMap(graphqlOutput.operationMap);

    const translatorResolvers = translator.createGraphQLResolvers();
    const executableSchema = makeExecutableSchema({
      typeDefs: graphqlOutput.typeDefs,
      resolvers: translatorResolvers,
    });

    const yoga = createYoga({
      schema: executableSchema,
      graphqlEndpoint: graphqlPath,
    });

    fastify.route({
      url: graphqlPath,
      method: ['GET', 'POST', 'OPTIONS'],
      handler: async (req, reply) => {
        const request = createWebRequest(req);
        const response = await yoga.handleRequest(request, {});

        response.headers.forEach((value: string, key: string) => {
          void reply.header(key, value);
        });

        void reply.status(response.status);

        if (response.body) {
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let done = false;

          while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) {
              chunks.push(result.value);
            }
          }

          const body = Buffer.concat(chunks);
          return reply.send(body);
        } else {
          return reply.send();
        }
      },
    });
  }

  // Setup REST proxy if enabled
  if (gatewayOptions.enableRestProxy !== false) {
    const restProxyPath = gatewayOptions.restProxyPath ?? DEFAULT_OPTIONS.restProxyPath;
    const routes = translator.generateRoutes();

    for (const route of routes) {
      const proxyUrl = `${restProxyPath}${route.path}`;

      fastify.route({
        method: route.method,
        url: proxyUrl,
        handler: route.handler,
      });
    }
  }

  // Decorate fastify with translator
  fastify.decorate('chameleonTranslator', translator);

  // Ensure async function has await
  await Promise.resolve();
}

/**
 * Register Chameleon as a Fastify plugin
 * Wrapped with fastify-plugin to ensure decorators are propagated
 */
export const chameleonPlugin = fp(chameleonPluginImpl, {
  name: 'chameleon',
  fastify: '4.x',
});

// ============================================================================
// Type Extensions
// ============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    chameleonTranslator?: Translator;
  }
}
