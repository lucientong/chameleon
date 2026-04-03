/**
 * Tests for Runtime Translator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Translator,
  createTranslator,
  createLoggingMiddleware,
  createErrorMiddleware,
  createHeaderMiddleware,
  createResponseTransformMiddleware,
  type TranslationContext,
  type TranslationResult,
  type BackendHandler,
} from '../../src/runtime/translator.js';
import {
  createPrimitiveType,
  createObjectType,
  createField,
  createService,
  createSchema,
  createVoidType,
  createParameter,
  type IRSchema,
  type IRMethod,
} from '../../src/parsers/ir.js';
import { RuntimeError } from '../../src/errors.js';

// Mock backend handler for testing
function createMockBackendHandler(
  response: TranslationResult = { statusCode: 200, body: { success: true } }
): BackendHandler {
  return vi.fn().mockResolvedValue(response);
}

// Create a minimal test schema
function createTestSchema(): IRSchema {
  const petType = createObjectType([
    createField('id', createPrimitiveType('integer'), true),
    createField('name', createPrimitiveType('string'), true),
    createField('status', createPrimitiveType('string'), false),
  ], { name: 'Pet' });

  const methods: IRMethod[] = [
    {
      name: 'listPets',
      description: 'List all pets',
      httpMethod: 'GET',
      path: '/pets',
      input: createVoidType(),
      output: petType,
      parameters: [
        createParameter('limit', createPrimitiveType('integer'), 'query', false),
        createParameter('status', createPrimitiveType('string'), 'query', false),
      ],
    },
    {
      name: 'getPetById',
      description: 'Get a pet by ID',
      httpMethod: 'GET',
      path: '/pets/{petId}',
      input: createVoidType(),
      output: petType,
      parameters: [
        createParameter('petId', createPrimitiveType('integer'), 'path', true),
      ],
    },
    {
      name: 'createPet',
      description: 'Create a new pet',
      httpMethod: 'POST',
      path: '/pets',
      input: createObjectType([
        createField('name', createPrimitiveType('string'), true),
        createField('status', createPrimitiveType('string'), false),
      ]),
      output: petType,
    },
    {
      name: 'updatePet',
      description: 'Update a pet',
      httpMethod: 'PUT',
      path: '/pets/{petId}',
      input: createObjectType([
        createField('name', createPrimitiveType('string'), false),
        createField('status', createPrimitiveType('string'), false),
      ]),
      output: petType,
      parameters: [
        createParameter('petId', createPrimitiveType('integer'), 'path', true),
      ],
    },
    {
      name: 'deletePet',
      description: 'Delete a pet',
      httpMethod: 'DELETE',
      path: '/pets/{petId}',
      input: createVoidType(),
      output: createVoidType(),
      parameters: [
        createParameter('petId', createPrimitiveType('integer'), 'path', true),
      ],
    },
  ];

  const service = createService('Pets', methods, { description: 'Pet operations' });
  return createSchema([service], 'openapi', { sourceVersion: '3.0.0' });
}

describe('Translator', () => {
  let schema: IRSchema;
  let translator: Translator;
  let mockHandler: BackendHandler;

  beforeEach(() => {
    schema = createTestSchema();
    mockHandler = createMockBackendHandler();
    translator = createTranslator(schema, {
      backendHandler: mockHandler,
      validateRequests: false,
    });
  });

  describe('Method Lookup', () => {
    it('should find method by name', () => {
      const result = translator.getMethodByName('listPets');
      expect(result).toBeDefined();
      expect(result?.method.name).toBe('listPets');
      expect(result?.serviceName).toBe('Pets');
    });

    it('should return undefined for unknown method', () => {
      const result = translator.getMethodByName('unknownMethod');
      expect(result).toBeUndefined();
    });

    it('should find method by path', () => {
      const method = translator.getMethodByPath('/pets', 'GET');
      expect(method).toBeDefined();
      expect(method?.name).toBe('listPets');
    });

    it('should return undefined for unknown path', () => {
      const method = translator.getMethodByPath('/unknown', 'GET');
      expect(method).toBeUndefined();
    });
  });

  describe('Route Generation', () => {
    it('should generate routes from schema', () => {
      const routes = translator.generateRoutes();
      expect(routes.length).toBe(5);
    });

    it('should convert OpenAPI path params to Fastify format', () => {
      const routes = translator.generateRoutes();
      const getPetRoute = routes.find((r) => r.irMethod.name === 'getPetById');
      expect(getPetRoute?.path).toBe('/pets/:petId');
    });

    it('should include correct HTTP method', () => {
      const routes = translator.generateRoutes();
      const getRoute = routes.find((r) => r.irMethod.name === 'listPets');
      const postRoute = routes.find((r) => r.irMethod.name === 'createPet');
      
      expect(getRoute?.method).toBe('GET');
      expect(postRoute?.method).toBe('POST');
    });
  });

  describe('GraphQL Resolvers', () => {
    it('should generate GraphQL resolvers', () => {
      const resolvers = translator.createGraphQLResolvers();
      
      expect(resolvers.Query).toBeDefined();
      expect(resolvers.Mutation).toBeDefined();
    });

    it('should map GET methods to Query', () => {
      const resolvers = translator.createGraphQLResolvers();
      
      expect(resolvers.Query?.listPets).toBeDefined();
      expect(resolvers.Query?.getPetById).toBeDefined();
    });

    it('should map POST/PUT/DELETE methods to Mutation', () => {
      const resolvers = translator.createGraphQLResolvers();
      
      expect(resolvers.Mutation?.createPet).toBeDefined();
      expect(resolvers.Mutation?.updatePet).toBeDefined();
      expect(resolvers.Mutation?.deletePet).toBeDefined();
    });
  });

  describe('Middleware Pipeline', () => {
    it('should execute middleware in order', async () => {
      const order: string[] = [];
      
      translator.use(async (_ctx, next) => {
        order.push('first-before');
        const result = await next();
        order.push('first-after');
        return result;
      });

      translator.use(async (_ctx, next) => {
        order.push('second-before');
        const result = await next();
        order.push('second-after');
        return result;
      });

      const resolvers = translator.createGraphQLResolvers();
      await resolvers.Query?.listPets?.(null, {}, {}, {});

      expect(order).toEqual([
        'first-before',
        'second-before',
        'second-after',
        'first-after',
      ]);
    });

    it('should allow middleware to modify response', async () => {
      translator.use(async (_ctx, next) => {
        const result = await next();
        return {
          ...result,
          body: { ...result.body as object, modified: true },
        };
      });

      const resolvers = translator.createGraphQLResolvers();
      const result = await resolvers.Query?.listPets?.(null, {}, {}, {});

      expect(result).toHaveProperty('modified', true);
    });
  });
});

describe('Middleware Factories', () => {
  describe('createLoggingMiddleware', () => {
    it('should log request and response', async () => {
      const logger = { info: vi.fn() };
      const middleware = createLoggingMiddleware(logger);

      const mockCtx = {
        method: { name: 'testMethod', httpMethod: 'GET', path: '/test' },
        serviceName: 'TestService',
      } as TranslationContext;

      const next = vi.fn().mockResolvedValue({ statusCode: 200, body: {} });
      await middleware(mockCtx, next);

      expect(logger.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('createErrorMiddleware', () => {
    it('should catch RuntimeError and return 500', async () => {
      const middleware = createErrorMiddleware();

      const mockCtx = {} as TranslationContext;
      const next = vi.fn().mockRejectedValue(new RuntimeError('Test error', 'testOp'));

      const result = await middleware(mockCtx, next);

      expect(result.statusCode).toBe(500);
      expect(result.body).toHaveProperty('error', 'Test error');
    });

    it('should handle generic errors', async () => {
      const middleware = createErrorMiddleware();

      const mockCtx = {} as TranslationContext;
      const next = vi.fn().mockRejectedValue(new Error('Generic error'));

      const result = await middleware(mockCtx, next);

      expect(result.statusCode).toBe(500);
      expect(result.body).toHaveProperty('error', 'Generic error');
    });

    it('should pass through successful results', async () => {
      const middleware = createErrorMiddleware();

      const mockCtx = {} as TranslationContext;
      const expectedResult = { statusCode: 200, body: { success: true } };
      const next = vi.fn().mockResolvedValue(expectedResult);

      const result = await middleware(mockCtx, next);

      expect(result).toEqual(expectedResult);
    });
  });

  describe('createHeaderMiddleware', () => {
    it('should add headers to context', async () => {
      const middleware = createHeaderMiddleware({ 'X-Custom': 'value' });

      const mockCtx = { data: {} } as TranslationContext;
      const next = vi.fn().mockResolvedValue({ statusCode: 200, body: {} });

      await middleware(mockCtx, next);

      expect(mockCtx.data.additionalHeaders).toEqual({ 'X-Custom': 'value' });
    });
  });

  describe('createResponseTransformMiddleware', () => {
    it('should transform response body', async () => {
      const transform = vi.fn().mockReturnValue({ transformed: true });
      const middleware = createResponseTransformMiddleware(transform);

      const mockCtx = {} as TranslationContext;
      const next = vi.fn().mockResolvedValue({
        statusCode: 200,
        body: { original: true },
      });

      const result = await middleware(mockCtx, next);

      expect(transform).toHaveBeenCalledWith({ original: true }, mockCtx);
      expect(result.body).toEqual({ transformed: true });
    });
  });
});

describe('createTranslator', () => {
  it('should create a translator with default options', () => {
    const schema = createTestSchema();
    const translator = createTranslator(schema);
    
    expect(translator).toBeInstanceOf(Translator);
  });

  it('should create a translator with custom options', () => {
    const schema = createTestSchema();
    const translator = createTranslator(schema, {
      backendBaseUrl: 'http://custom-backend.local',
      timeout: 5000,
    });
    
    expect(translator).toBeInstanceOf(Translator);
  });
});
