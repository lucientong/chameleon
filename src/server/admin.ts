/**
 * Admin API
 *
 * Provides management endpoints for the Chameleon gateway:
 *   GET /admin/schema      - Current schema information
 *   GET /admin/routes      - Route table
 *   GET /admin/stats       - Translation and reload statistics
 *   GET /admin/health      - Detailed health check
 *   POST /admin/reload     - Trigger manual schema reload
 *
 * The admin API is registered as a Fastify plugin and can be
 * mounted on any prefix (default: /admin).
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { IRSchema, IRService, IRMethod } from '../parsers/ir.js';
import type { HotReloadManager, HotReloadStats } from '../watcher/hot-reload.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Admin API plugin options
 */
export interface AdminOptions extends FastifyPluginOptions {
  /** Prefix for admin routes (default: /admin) */
  prefix?: string;
  /** Callback to get the current active schema */
  getSchema: () => IRSchema | null;
  /** Optional hot reload manager for reload-related endpoints */
  hotReloadManager?: HotReloadManager;
  /** Optional custom stats provider */
  getCustomStats?: () => Record<string, unknown>;
  /** Whether to expose the reload endpoint (requires hotReloadManager) */
  enableReload?: boolean;
}

/**
 * Schema summary returned by the admin API
 */
export interface SchemaInfo {
  sourceType: string;
  sourceVersion?: string;
  title?: string;
  description?: string;
  version?: string;
  statistics: {
    services: number;
    methods: number;
    queries: number;
    mutations: number;
    streaming: number;
  };
  services: ServiceInfo[];
}

/**
 * Service summary
 */
export interface ServiceInfo {
  name: string;
  description?: string;
  methodCount: number;
  methods: MethodInfo[];
}

/**
 * Method summary
 */
export interface MethodInfo {
  name: string;
  description?: string;
  httpMethod?: string;
  path?: string;
  deprecated?: boolean;
  streaming?: string;
  tags?: string[];
}

/**
 * Route information
 */
export interface RouteInfo {
  method: string;
  path: string;
  operationId: string;
  service: string;
  deprecated: boolean;
  streaming: boolean;
}

/**
 * Admin stats response
 */
export interface AdminStatsResponse {
  uptime: number;
  uptimeHuman: string;
  schema: SchemaInfo | null;
  hotReload?: HotReloadStats;
  custom?: Record<string, unknown>;
  timestamp: string;
}

// ============================================================================
// Plugin Implementation
// ============================================================================

/**
 * Internal admin plugin implementation
 */
async function adminPluginImpl(
  fastify: FastifyInstance,
  options: AdminOptions
): Promise<void> {
  const {
    getSchema,
    hotReloadManager,
    getCustomStats,
    enableReload = true,
  } = options;

  const startTime = Date.now();

  // =========================================================================
  // GET /schema - Current schema information
  // =========================================================================

  fastify.get('/schema', () => {
    const schema = getSchema();
    if (!schema) {
      return { error: 'No schema loaded', schema: null };
    }
    return { schema: buildSchemaInfo(schema) };
  });

  // =========================================================================
  // GET /routes - Route table
  // =========================================================================

  fastify.get('/routes', () => {
    const schema = getSchema();
    if (!schema) {
      return { error: 'No schema loaded', routes: [] };
    }
    return { routes: buildRouteTable(schema) };
  });

  // =========================================================================
  // GET /stats - Statistics
  // =========================================================================

  fastify.get('/stats', () => {
    const schema = getSchema();
    const response: AdminStatsResponse = {
      uptime: (Date.now() - startTime) / 1000,
      uptimeHuman: formatUptime(Date.now() - startTime),
      schema: schema ? buildSchemaInfo(schema) : null,
      timestamp: new Date().toISOString(),
    };

    if (hotReloadManager) {
      response.hotReload = hotReloadManager.getStats();
    }

    if (getCustomStats) {
      response.custom = getCustomStats();
    }

    return response;
  });

  // =========================================================================
  // GET /health - Detailed health check
  // =========================================================================

  fastify.get('/health', () => {
    const schema = getSchema();
    const healthy = schema !== null;

    return {
      status: healthy ? 'healthy' : 'degraded',
      checks: {
        schema: {
          status: schema ? 'pass' : 'fail',
          message: schema
            ? `Loaded: ${schema.sourceType} with ${schema.services.length} services`
            : 'No schema loaded',
        },
        hotReload: hotReloadManager
          ? {
              status: hotReloadManager.getState() === 'idle' ? 'pass' : 'warn',
              state: hotReloadManager.getState(),
            }
          : { status: 'skip', message: 'Hot reload not configured' },
      },
      timestamp: new Date().toISOString(),
    };
  });

  // =========================================================================
  // POST /reload - Manual schema reload
  // =========================================================================

  if (enableReload && hotReloadManager) {
    const manager = hotReloadManager;

    fastify.post<{
      Body: { filePath?: string; format?: string };
    }>('/reload', async (request) => {
      const { filePath, format } = request.body ?? {};

      if (!filePath) {
        return {
          error: 'Missing required field: filePath',
          success: false,
        };
      }

      const schemaFormat =
        (format as 'openapi' | 'protobuf' | 'graphql') ?? 'openapi';

      try {
        const startMs = Date.now();
        await manager.reload(filePath, schemaFormat);
        const elapsed = Date.now() - startMs;

        return {
          success: true,
          message: `Schema reloaded from ${filePath}`,
          compilationTimeMs: elapsed,
        };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: msg,
        };
      }
    });
  }

  // =========================================================================
  // GET /services - List services
  // =========================================================================

  fastify.get('/services', () => {
    const schema = getSchema();
    if (!schema) {
      return { error: 'No schema loaded', services: [] };
    }

    return {
      services: schema.services.map((s) => ({
        name: s.name,
        description: s.description,
        methodCount: s.methods.length,
      })),
    };
  });

  // =========================================================================
  // GET /services/:name - Service details
  // =========================================================================

  fastify.get<{
    Params: { name: string };
  }>('/services/:name', (request) => {
    const schema = getSchema();
    if (!schema) {
      return { error: 'No schema loaded', service: null };
    }

    const service = schema.services.find(
      (s) => s.name === request.params.name
    );
    if (!service) {
      return {
        error: `Service not found: ${request.params.name}`,
        service: null,
      };
    }

    return {
      service: {
        name: service.name,
        description: service.description,
        methods: service.methods.map(buildMethodInfo),
      },
    };
  });

  // Ensure the async function body has an await
  await Promise.resolve();
}

// ============================================================================
// Plugin Registration
// ============================================================================

/**
 * Admin API Fastify plugin (encapsulated, supports prefix routing)
 */
export const adminPlugin = adminPluginImpl;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build schema information summary
 */
function buildSchemaInfo(schema: IRSchema): SchemaInfo {
  let queryCount = 0;
  let mutationCount = 0;
  let streamingCount = 0;
  let totalMethods = 0;

  const services: ServiceInfo[] = schema.services.map((s) => {
    const sInfo = buildServiceInfo(s);
    totalMethods += s.methods.length;

    for (const m of s.methods) {
      if (m.httpMethod === 'GET' || m.httpMethod === 'HEAD') {
        queryCount++;
      } else if (m.httpMethod) {
        mutationCount++;
      }
      if (m.streaming) {
        streamingCount++;
      }
    }

    return sInfo;
  });

  return {
    sourceType: schema.sourceType,
    sourceVersion: schema.sourceVersion,
    title: schema.title,
    description: schema.description,
    version: schema.version,
    statistics: {
      services: schema.services.length,
      methods: totalMethods,
      queries: queryCount,
      mutations: mutationCount,
      streaming: streamingCount,
    },
    services,
  };
}

/**
 * Build service info
 */
function buildServiceInfo(service: IRService): ServiceInfo {
  return {
    name: service.name,
    description: service.description,
    methodCount: service.methods.length,
    methods: service.methods.map(buildMethodInfo),
  };
}

/**
 * Build method info
 */
function buildMethodInfo(method: IRMethod): MethodInfo {
  return {
    name: method.name,
    description: method.description,
    httpMethod: method.httpMethod,
    path: method.path,
    deprecated: method.deprecated,
    streaming: method.streaming,
    tags: method.tags,
  };
}

/**
 * Build route table from schema
 */
function buildRouteTable(schema: IRSchema): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const service of schema.services) {
    for (const method of service.methods) {
      if (method.httpMethod && method.path) {
        routes.push({
          method: method.httpMethod,
          path: method.path,
          operationId: method.name,
          service: service.name,
          deprecated: method.deprecated ?? false,
          streaming: method.streaming !== undefined,
        });
      }
    }
  }

  // Sort by path then method
  routes.sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) {
      return pathCmp;
    }
    return a.method.localeCompare(b.method);
  });

  return routes;
}

/**
 * Format uptime in human-readable form
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours % 24 > 0) {
    parts.push(`${hours % 24}h`);
  }
  if (minutes % 60 > 0) {
    parts.push(`${minutes % 60}m`);
  }
  parts.push(`${seconds % 60}s`);

  return parts.join(' ');
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Register admin API on a Fastify instance
 */
export async function registerAdminAPI(
  app: FastifyInstance,
  options: AdminOptions
): Promise<void> {
  const prefix = options.prefix ?? '/admin';
  await app.register(adminPlugin, {
    ...options,
    prefix,
  });
}
