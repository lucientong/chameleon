/**
 * DataLoader Auto-Injection Tests
 *
 * Tests for N+1 pattern detection, DataLoader creation,
 * per-request scoping, and middleware integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  IRSchema,
  IRService,
} from '../../src/parsers/ir.js';
import {
  createPrimitiveType,
  createObjectType,
  createArrayType,
  createField,
  createParameter,
  createVoidType,
} from '../../src/parsers/ir.js';
import {
  detectBatchableEndpoints,
  DataLoaderManager,
  RequestDataLoaderScope,
  createDataLoaderMiddleware,
  createDataLoaderManager,
  createDataLoaderContext,
  analyzeN1Patterns,
} from '../../src/runtime/dataloader.js';
import type {
  TranslationContext,
  TranslationResult,
  BackendHandler,
} from '../../src/runtime/translator.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const petType = createObjectType(
  [
    createField('id', createPrimitiveType('string'), true),
    createField('name', createPrimitiveType('string'), true),
    createField('status', createPrimitiveType('string'), false),
  ],
  { name: 'Pet' }
);

const userType = createObjectType(
  [
    createField('userId', createPrimitiveType('string'), true),
    createField('username', createPrimitiveType('string'), true),
    createField('email', createPrimitiveType('string'), false),
  ],
  { name: 'User' }
);

function createTestSchema(): IRSchema {
  const petService: IRService = {
    name: 'PetService',
    methods: [
      // Detail endpoint (batchable)
      {
        name: 'getPetById',
        httpMethod: 'GET',
        path: '/pets/{petId}',
        input: createObjectType([
          createField('petId', createPrimitiveType('string'), true),
        ]),
        output: petType,
        parameters: [
          createParameter('petId', createPrimitiveType('string'), 'path', true),
        ],
      },
      // List endpoint
      {
        name: 'listPets',
        httpMethod: 'GET',
        path: '/pets',
        input: createVoidType(),
        output: createArrayType(petType),
      },
      // Create endpoint (not batchable — POST)
      {
        name: 'createPet',
        httpMethod: 'POST',
        path: '/pets',
        input: petType,
        output: petType,
      },
    ],
  };

  const userService: IRService = {
    name: 'UserService',
    methods: [
      // Detail endpoint (batchable)
      {
        name: 'getUserById',
        httpMethod: 'GET',
        path: '/users/{userId}',
        input: createObjectType([
          createField('userId', createPrimitiveType('string'), true),
        ]),
        output: userType,
        parameters: [
          createParameter('userId', createPrimitiveType('string'), 'path', true),
        ],
      },
      // List endpoint
      {
        name: 'listUsers',
        httpMethod: 'GET',
        path: '/users',
        input: createVoidType(),
        output: createArrayType(userType),
      },
    ],
  };

  return {
    services: [petService, userService],
    sourceType: 'openapi',
  };
}

function createMockBackendHandler(
  responses?: Map<string, unknown>
): BackendHandler {
  return async (ctx: TranslationContext): Promise<TranslationResult> => {
    const key = `${ctx.method.name}:${JSON.stringify(ctx.pathParams)}`;

    if (responses?.has(key)) {
      return {
        statusCode: 200,
        body: responses.get(key),
      };
    }

    // Default: return a mock object with the ID
    const id = Object.values(ctx.pathParams)[0] ?? 'unknown';
    return {
      statusCode: 200,
      body: { id, name: `Item ${id}` },
    };
  };
}

// ============================================================================
// Tests: N+1 Pattern Detection
// ============================================================================

describe('detectBatchableEndpoints', () => {
  it('should detect GET endpoints with ID parameters', () => {
    const schema = createTestSchema();
    const endpoints = detectBatchableEndpoints(schema);

    expect(endpoints.length).toBe(2);

    const petEndpoint = endpoints.find(
      (ep) => ep.detailMethod.name === 'getPetById'
    );
    expect(petEndpoint).toBeDefined();
    expect(petEndpoint!.idParam).toBe('petId');
    expect(petEndpoint!.serviceName).toBe('PetService');
    expect(petEndpoint!.outputTypeName).toBe('Pet');
  });

  it('should match list endpoints with detail endpoints', () => {
    const schema = createTestSchema();
    const endpoints = detectBatchableEndpoints(schema);

    const petEndpoint = endpoints.find(
      (ep) => ep.detailMethod.name === 'getPetById'
    );
    expect(petEndpoint!.listMethod).toBeDefined();
    expect(petEndpoint!.listMethod!.name).toBe('listPets');
  });

  it('should not detect POST/PUT/DELETE as batchable', () => {
    const schema = createTestSchema();
    const endpoints = detectBatchableEndpoints(schema);

    const createEndpoint = endpoints.find(
      (ep) => ep.detailMethod.name === 'createPet'
    );
    expect(createEndpoint).toBeUndefined();
  });

  it('should handle schema with no batchable endpoints', () => {
    const schema: IRSchema = {
      services: [
        {
          name: 'EmptyService',
          methods: [
            {
              name: 'listItems',
              httpMethod: 'GET',
              path: '/items',
              input: createVoidType(),
              output: createArrayType(createPrimitiveType('string')),
            },
          ],
        },
      ],
      sourceType: 'openapi',
    };

    const endpoints = detectBatchableEndpoints(schema);
    expect(endpoints.length).toBe(0);
  });

  it('should detect endpoints using path pattern when no explicit parameters', () => {
    const schema: IRSchema = {
      services: [
        {
          name: 'ItemService',
          methods: [
            {
              name: 'getItem',
              httpMethod: 'GET',
              path: '/items/{id}',
              input: createObjectType([
                createField('id', createPrimitiveType('string'), true),
              ]),
              output: createObjectType(
                [createField('id', createPrimitiveType('string'), true)],
                { name: 'Item' }
              ),
            },
          ],
        },
      ],
      sourceType: 'openapi',
    };

    const endpoints = detectBatchableEndpoints(schema);
    expect(endpoints.length).toBe(1);
    expect(endpoints[0]!.idParam).toBe('id');
  });

  it('should detect user service endpoints', () => {
    const schema = createTestSchema();
    const endpoints = detectBatchableEndpoints(schema);

    const userEndpoint = endpoints.find(
      (ep) => ep.detailMethod.name === 'getUserById'
    );
    expect(userEndpoint).toBeDefined();
    expect(userEndpoint!.idParam).toBe('userId');
    expect(userEndpoint!.serviceName).toBe('UserService');
    expect(userEndpoint!.listMethod!.name).toBe('listUsers');
  });
});

// ============================================================================
// Tests: DataLoaderManager
// ============================================================================

describe('DataLoaderManager', () => {
  let schema: IRSchema;
  let handler: BackendHandler;

  beforeEach(() => {
    schema = createTestSchema();
    handler = createMockBackendHandler();
  });

  it('should create with auto-detection enabled', () => {
    const manager = new DataLoaderManager(schema, handler);
    const endpoints = manager.getBatchableEndpoints();
    expect(endpoints.length).toBe(2);
  });

  it('should identify batchable methods', () => {
    const manager = new DataLoaderManager(schema, handler);
    expect(manager.isBatchable('getPetById', 'PetService')).toBe(true);
    expect(manager.isBatchable('getUserById', 'UserService')).toBe(true);
    expect(manager.isBatchable('createPet', 'PetService')).toBe(false);
    expect(manager.isBatchable('listPets', 'PetService')).toBe(false);
  });

  it('should identify batchable methods without service name', () => {
    const manager = new DataLoaderManager(schema, handler);
    expect(manager.isBatchable('getPetById')).toBe(true);
    expect(manager.isBatchable('nonExistent')).toBe(false);
  });

  it('should create DataLoader instances', () => {
    const manager = new DataLoaderManager(schema, handler);
    const loader = manager.getLoader('getPetById', 'PetService');
    expect(loader).not.toBeNull();
  });

  it('should return null for non-batchable methods', () => {
    const manager = new DataLoaderManager(schema, handler);
    const loader = manager.getLoader('createPet', 'PetService');
    expect(loader).toBeNull();
  });

  it('should load data through DataLoader', async () => {
    const mockHandler = vi.fn(async (ctx: TranslationContext) => ({
      statusCode: 200,
      body: { id: ctx.pathParams['petId'], name: 'Test Pet' },
    }));

    const manager = new DataLoaderManager(schema, mockHandler);
    const loader = manager.getLoader('getPetById', 'PetService');

    const result = await loader!.load('pet-123');
    expect(result).toEqual({ id: 'pet-123', name: 'Test Pet' });
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it('should batch multiple loads', async () => {
    const callCount = { value: 0 };
    const mockHandler = vi.fn(async (ctx: TranslationContext) => {
      callCount.value++;
      return {
        statusCode: 200,
        body: { id: ctx.pathParams['petId'], name: `Pet ${ctx.pathParams['petId']}` },
      };
    });

    const manager = new DataLoaderManager(schema, mockHandler, { cache: false });
    const loader = manager.getLoader('getPetById', 'PetService');

    // Load multiple items in the same tick
    const [result1, result2, result3] = await Promise.all([
      loader!.load('1'),
      loader!.load('2'),
      loader!.load('3'),
    ]);

    expect(result1).toEqual({ id: '1', name: 'Pet 1' });
    expect(result2).toEqual({ id: '2', name: 'Pet 2' });
    expect(result3).toEqual({ id: '3', name: 'Pet 3' });

    // Should have been called for each item (default batch fn calls individually)
    expect(mockHandler).toHaveBeenCalledTimes(3);
  });

  it('should track statistics', async () => {
    const manager = new DataLoaderManager(schema, handler);
    const loader = manager.getLoader('getPetById', 'PetService');

    await loader!.load('1');

    const stats = manager.getStats();
    expect(stats.batchableEndpoints).toBe(2);
    expect(stats.loadersCreated).toBeGreaterThanOrEqual(1);
    expect(stats.batchCalls).toBeGreaterThanOrEqual(1);
  });

  it('should support manual endpoints', () => {
    const manager = new DataLoaderManager(schema, handler, {
      manualEndpoints: [
        {
          detailMethodName: 'createPet',
          serviceName: 'PetService',
          idParam: 'id',
        },
      ],
    });

    // Should have auto-detected + manual
    expect(manager.getBatchableEndpoints().length).toBeGreaterThanOrEqual(2);
  });

  it('should support custom batch functions', async () => {
    const customFn = vi.fn(async (keys: readonly string[]) => {
      return keys.map((k) => ({ id: k, custom: true }));
    });

    const manager = new DataLoaderManager(schema, handler, {
      customBatchFn: {
        'PetService.getPetById': customFn,
      },
    });

    const loader = manager.getLoader('getPetById', 'PetService');
    const result = await loader!.load('custom-1');

    expect(result).toEqual({ id: 'custom-1', custom: true });
    expect(customFn).toHaveBeenCalled();
  });

  it('should handle autoDetect disabled', () => {
    const manager = new DataLoaderManager(schema, handler, {
      autoDetect: false,
    });

    expect(manager.getBatchableEndpoints().length).toBe(0);
  });

  it('should support cache TTL for global loaders', () => {
    const manager = new DataLoaderManager(schema, handler, {
      cacheTTL: 5000,
    });

    const loader1 = manager.getLoader('getPetById', 'PetService');
    const loader2 = manager.getLoader('getPetById', 'PetService');

    // Same loader should be returned within TTL
    expect(loader1).toBe(loader2);
  });

  it('should clear cache', () => {
    const manager = new DataLoaderManager(schema, handler, {
      cacheTTL: 5000,
    });

    manager.getLoader('getPetById', 'PetService');
    manager.clearCache();

    // After clearing, a new loader should be created
    const stats = manager.getStats();
    expect(stats.loadersCreated).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Tests: RequestDataLoaderScope
// ============================================================================

describe('RequestDataLoaderScope', () => {
  let schema: IRSchema;
  let manager: DataLoaderManager;

  beforeEach(() => {
    schema = createTestSchema();
    const handler = createMockBackendHandler();
    manager = new DataLoaderManager(schema, handler);
  });

  it('should create per-request scope', () => {
    const scope = manager.createRequestScope();
    expect(scope).toBeInstanceOf(RequestDataLoaderScope);
  });

  it('should load single item', async () => {
    const scope = manager.createRequestScope();
    const result = await scope.load('getPetById', 'pet-1', 'PetService');
    expect(result).toBeDefined();
  });

  it('should load multiple items', async () => {
    const scope = manager.createRequestScope();
    const results = await scope.loadMany(
      'getPetById',
      ['pet-1', 'pet-2'],
      'PetService'
    );
    expect(results).toHaveLength(2);
  });

  it('should prime cache', async () => {
    const scope = manager.createRequestScope();
    scope.prime('getPetById', 'primed-1', { id: 'primed-1', name: 'Primed' }, 'PetService');

    const result = await scope.load('getPetById', 'primed-1', 'PetService');
    expect(result).toEqual({ id: 'primed-1', name: 'Primed' });
  });

  it('should clear specific item from cache', async () => {
    const scope = manager.createRequestScope();
    scope.prime('getPetById', 'clear-1', { id: 'clear-1' }, 'PetService');
    scope.clear('getPetById', 'clear-1', 'PetService');

    // Should fetch again after clearing
    const result = await scope.load('getPetById', 'clear-1', 'PetService');
    expect(result).toBeDefined();
  });

  it('should clear all cached items', async () => {
    const scope = manager.createRequestScope();
    scope.prime('getPetById', 'a', { id: 'a' }, 'PetService');
    scope.prime('getUserById', 'b', { id: 'b' }, 'UserService');
    scope.clearAll();

    // Loaders should still work after clearAll
    const result = await scope.load('getPetById', 'a', 'PetService');
    expect(result).toBeDefined();
  });

  it('should throw for non-batchable methods', async () => {
    const scope = manager.createRequestScope();
    await expect(
      scope.load('nonExistent', 'id-1')
    ).rejects.toThrow(/No DataLoader available/);
  });
});

// ============================================================================
// Tests: DataLoader Middleware
// ============================================================================

describe('createDataLoaderMiddleware', () => {
  let schema: IRSchema;
  let handler: BackendHandler;

  beforeEach(() => {
    schema = createTestSchema();
    handler = createMockBackendHandler();
  });

  it('should intercept batchable requests', async () => {
    const manager = new DataLoaderManager(schema, handler);
    const middleware = createDataLoaderMiddleware(manager);

    const ctx: TranslationContext = {
      request: {} as any,
      reply: {} as any,
      pathParams: { petId: 'pet-1' },
      queryParams: {},
      body: undefined,
      params: { petId: 'pet-1' },
      method: schema.services[0]!.methods[0]!, // getPetById
      serviceName: 'PetService',
      data: {},
    };

    const next = vi.fn();
    const result = await middleware(ctx, next);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBeDefined();
    // next() should NOT be called because DataLoader handled it
    expect(next).not.toHaveBeenCalled();
  });

  it('should pass through non-batchable requests', async () => {
    const manager = new DataLoaderManager(schema, handler);
    const middleware = createDataLoaderMiddleware(manager);

    const ctx: TranslationContext = {
      request: {} as any,
      reply: {} as any,
      pathParams: {},
      queryParams: {},
      body: { name: 'New Pet' },
      params: {},
      method: schema.services[0]!.methods[2]!, // createPet
      serviceName: 'PetService',
      data: {},
    };

    const nextResult: TranslationResult = { statusCode: 201, body: { id: 'new' } };
    const next = vi.fn(async () => nextResult);

    const result = await middleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(result).toBe(nextResult);
  });

  it('should skip DataLoader calls (prevent infinite loop)', async () => {
    const manager = new DataLoaderManager(schema, handler);
    const middleware = createDataLoaderMiddleware(manager);

    const ctx: TranslationContext = {
      request: {} as any,
      reply: {} as any,
      pathParams: { petId: 'pet-1' },
      queryParams: {},
      body: undefined,
      params: { petId: 'pet-1' },
      method: schema.services[0]!.methods[0]!, // getPetById
      serviceName: 'PetService',
      data: { __dataloader: true }, // Flag indicating this is from DataLoader
    };

    const nextResult: TranslationResult = { statusCode: 200, body: { id: 'pet-1' } };
    const next = vi.fn(async () => nextResult);

    const result = await middleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(result).toBe(nextResult);
  });

  it('should handle errors from DataLoader', async () => {
    const failingHandler = vi.fn(async () => ({
      statusCode: 404,
      body: { error: 'Not found' },
    }));

    const manager = new DataLoaderManager(schema, failingHandler);
    const middleware = createDataLoaderMiddleware(manager);

    const ctx: TranslationContext = {
      request: {} as any,
      reply: {} as any,
      pathParams: { petId: 'not-found' },
      queryParams: {},
      body: undefined,
      params: { petId: 'not-found' },
      method: schema.services[0]!.methods[0]!,
      serviceName: 'PetService',
      data: {},
    };

    const next = vi.fn();
    const result = await middleware(ctx, next);

    expect(result.statusCode).toBe(500);
  });
});

// ============================================================================
// Tests: Convenience Functions
// ============================================================================

describe('Convenience Functions', () => {
  it('createDataLoaderManager should create a manager', () => {
    const schema = createTestSchema();
    const handler = createMockBackendHandler();
    const manager = createDataLoaderManager(schema, handler);

    expect(manager).toBeInstanceOf(DataLoaderManager);
    expect(manager.getBatchableEndpoints().length).toBe(2);
  });

  it('createDataLoaderContext should create a context factory', () => {
    const schema = createTestSchema();
    const handler = createMockBackendHandler();
    const manager = createDataLoaderManager(schema, handler);

    const contextFactory = createDataLoaderContext(manager);
    const context = contextFactory();

    expect(context.dataLoaderScope).toBeInstanceOf(RequestDataLoaderScope);
  });

  it('analyzeN1Patterns should return a report', () => {
    const schema = createTestSchema();
    const report = analyzeN1Patterns(schema);

    expect(report.endpoints.length).toBe(2);
    expect(report.summary).toContain('2 potential N+1 pattern');
    expect(report.summary).toContain('Pet');
    expect(report.summary).toContain('User');
    expect(report.summary).toContain('petId');
    expect(report.summary).toContain('userId');
  });

  it('analyzeN1Patterns should handle empty schema', () => {
    const schema: IRSchema = {
      services: [],
      sourceType: 'openapi',
    };

    const report = analyzeN1Patterns(schema);
    expect(report.endpoints.length).toBe(0);
    expect(report.summary).toContain('No N+1 patterns detected');
  });
});
