/**
 * Tests for the Admin API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAdminAPI, type AdminOptions } from '../../src/server/admin.js';
import type { IRSchema } from '../../src/parsers/ir.js';
import {
  createSchema,
  createService,
  createMethod,
  createPrimitiveType,
  createObjectType,
  createField,
} from '../../src/parsers/ir.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestSchema(): IRSchema {
  return createSchema(
    [
      createService('PetService', [
        createMethod(
          'listPets',
          createObjectType([
            createField('limit', createPrimitiveType('integer'), false),
          ]),
          createObjectType([], { name: 'PetList' }),
          {
            httpMethod: 'GET',
            path: '/pets',
            description: 'List all pets',
            tags: ['pets'],
          }
        ),
        createMethod(
          'createPet',
          createObjectType([
            createField('name', createPrimitiveType('string'), true),
          ]),
          createObjectType([], { name: 'Pet' }),
          {
            httpMethod: 'POST',
            path: '/pets',
            description: 'Create a pet',
            tags: ['pets'],
          }
        ),
        createMethod(
          'getPet',
          createObjectType([
            createField('petId', createPrimitiveType('string'), true),
          ]),
          createObjectType([], { name: 'Pet' }),
          {
            httpMethod: 'GET',
            path: '/pets/{petId}',
            description: 'Get a pet',
            tags: ['pets'],
          }
        ),
      ]),
      createService('UserService', [
        createMethod(
          'getUser',
          createObjectType([
            createField('userId', createPrimitiveType('string'), true),
          ]),
          createObjectType([], { name: 'User' }),
          {
            httpMethod: 'GET',
            path: '/users/{userId}',
            description: 'Get a user',
            deprecated: true,
          }
        ),
      ]),
    ],
    'openapi',
    {
      sourceVersion: '3.0.0',
      title: 'Test API',
      description: 'A test API',
      version: '1.0.0',
    }
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Admin API', () => {
  let app: FastifyInstance;
  let schema: IRSchema;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    schema = createTestSchema();
  });

  afterEach(async () => {
    await app.close();
  });

  async function registerAdmin(
    overrides?: Partial<AdminOptions>
  ): Promise<void> {
    await registerAdminAPI(app, {
      getSchema: () => schema,
      ...overrides,
    });
    await app.ready();
  }

  // =========================================================================
  // GET /admin/schema
  // =========================================================================

  describe('GET /admin/schema', () => {
    it('should return schema information', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/schema',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ schema: Record<string, unknown> }>();
      expect(body.schema).toBeDefined();
      expect(body.schema.sourceType).toBe('openapi');
      expect(body.schema.title).toBe('Test API');
    });

    it('should include statistics', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/schema',
      });

      const body = response.json<{
        schema: { statistics: Record<string, number> };
      }>();
      expect(body.schema.statistics.services).toBe(2);
      expect(body.schema.statistics.methods).toBe(4);
      expect(body.schema.statistics.queries).toBe(3); // 3 GETs
      expect(body.schema.statistics.mutations).toBe(1); // 1 POST
    });

    it('should include service details', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/schema',
      });

      const body = response.json<{
        schema: { services: Array<{ name: string; methodCount: number }> };
      }>();
      expect(body.schema.services).toHaveLength(2);
      expect(body.schema.services[0]!.name).toBe('PetService');
      expect(body.schema.services[0]!.methodCount).toBe(3);
    });

    it('should handle null schema', async () => {
      await registerAdmin({ getSchema: () => null });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/schema',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ error: string; schema: null }>();
      expect(body.error).toBe('No schema loaded');
      expect(body.schema).toBeNull();
    });
  });

  // =========================================================================
  // GET /admin/routes
  // =========================================================================

  describe('GET /admin/routes', () => {
    it('should return route table', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/routes',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        routes: Array<{
          method: string;
          path: string;
          operationId: string;
          service: string;
        }>;
      }>();
      expect(body.routes).toHaveLength(4);

      // Should be sorted by path
      expect(body.routes[0]!.path).toBe('/pets');
    });

    it('should include deprecated flag', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/routes',
      });

      const body = response.json<{
        routes: Array<{ deprecated: boolean; operationId: string }>;
      }>();
      const deprecatedRoute = body.routes.find(
        (r) => r.operationId === 'getUser'
      );
      expect(deprecatedRoute?.deprecated).toBe(true);
    });

    it('should handle null schema', async () => {
      await registerAdmin({ getSchema: () => null });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/routes',
      });

      const body = response.json<{ routes: unknown[]; error: string }>();
      expect(body.routes).toEqual([]);
      expect(body.error).toBe('No schema loaded');
    });
  });

  // =========================================================================
  // GET /admin/stats
  // =========================================================================

  describe('GET /admin/stats', () => {
    it('should return stats', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        uptime: number;
        uptimeHuman: string;
        schema: Record<string, unknown>;
        timestamp: string;
      }>();

      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.uptimeHuman).toBeDefined();
      expect(body.schema).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    it('should include custom stats when provided', async () => {
      await registerAdmin({
        getCustomStats: () => ({ requestCount: 42, cacheHits: 10 }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/stats',
      });

      const body = response.json<{
        custom: { requestCount: number; cacheHits: number };
      }>();
      expect(body.custom?.requestCount).toBe(42);
      expect(body.custom?.cacheHits).toBe(10);
    });
  });

  // =========================================================================
  // GET /admin/health
  // =========================================================================

  describe('GET /admin/health', () => {
    it('should return healthy status with loaded schema', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        status: string;
        checks: { schema: { status: string } };
      }>();
      expect(body.status).toBe('healthy');
      expect(body.checks.schema.status).toBe('pass');
    });

    it('should return degraded status with no schema', async () => {
      await registerAdmin({ getSchema: () => null });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/health',
      });

      const body = response.json<{
        status: string;
        checks: { schema: { status: string } };
      }>();
      expect(body.status).toBe('degraded');
      expect(body.checks.schema.status).toBe('fail');
    });

    it('should skip hot reload check when not configured', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/health',
      });

      const body = response.json<{
        checks: { hotReload: { status: string } };
      }>();
      expect(body.checks.hotReload.status).toBe('skip');
    });
  });

  // =========================================================================
  // GET /admin/services
  // =========================================================================

  describe('GET /admin/services', () => {
    it('should list all services', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/services',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        services: Array<{
          name: string;
          methodCount: number;
        }>;
      }>();
      expect(body.services).toHaveLength(2);
      expect(body.services[0]!.name).toBe('PetService');
      expect(body.services[0]!.methodCount).toBe(3);
    });
  });

  // =========================================================================
  // GET /admin/services/:name
  // =========================================================================

  describe('GET /admin/services/:name', () => {
    it('should return service details', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/services/PetService',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        service: {
          name: string;
          methods: Array<{ name: string; httpMethod: string }>;
        };
      }>();
      expect(body.service.name).toBe('PetService');
      expect(body.service.methods).toHaveLength(3);
    });

    it('should return null for unknown service', async () => {
      await registerAdmin();

      const response = await app.inject({
        method: 'GET',
        url: '/admin/services/NonExistent',
      });

      const body = response.json<{ error: string; service: null }>();
      expect(body.service).toBeNull();
      expect(body.error).toContain('Service not found');
    });
  });

  // =========================================================================
  // Custom Prefix
  // =========================================================================

  describe('custom prefix', () => {
    it('should support custom prefix', async () => {
      await registerAdmin({ prefix: '/_admin' });

      const response = await app.inject({
        method: 'GET',
        url: '/_admin/schema',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // POST /admin/reload
  // =========================================================================

  describe('POST /admin/reload', () => {
    it('should return error when no filePath provided', async () => {
      await registerAdmin({ enableReload: false });

      // Without hot reload manager, the reload endpoint shouldn't exist
      const response = await app.inject({
        method: 'POST',
        url: '/admin/reload',
        body: {},
      });

      // Should be 404 since enableReload is false and no hotReloadManager
      expect(response.statusCode).toBe(404);
    });
  });
});
