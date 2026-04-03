/**
 * Tests for REST Generator
 */

import { describe, it, expect } from 'vitest';
import {
  RestGenerator,
  generateRestRoutes,
  generateRouteConfigs,
} from '../../src/generators/rest-generator.js';
import {
  createPrimitiveType,
  createObjectType,
  createArrayType,
  createEnumType,
  createField,
  createMethod,
  createService,
  createSchema,
  createVoidType,
  createParameter,
  type IRSchema,
} from '../../src/parsers/ir.js';

// Create a test schema
function createTestSchema(): IRSchema {
  const petType = createObjectType([
    createField('id', createPrimitiveType('integer', { format: 'int64' }), true),
    createField('name', createPrimitiveType('string'), true),
    createField('status', createEnumType(['available', 'pending', 'sold']), false),
  ], { name: 'Pet' });

  const petListType = createArrayType(petType);

  const methods = [
    createMethod(
      'listPets',
      createVoidType(),
      petListType,
      {
        httpMethod: 'GET',
        path: '/pets',
        description: 'List all pets',
        parameters: [
          createParameter('limit', createPrimitiveType('integer'), 'query', false),
          createParameter('status', createPrimitiveType('string'), 'query', false),
        ],
      }
    ),
    createMethod(
      'getPetById',
      createVoidType(),
      petType,
      {
        httpMethod: 'GET',
        path: '/pets/{petId}',
        description: 'Get a pet by ID',
        parameters: [
          createParameter('petId', createPrimitiveType('integer'), 'path', true),
        ],
      }
    ),
    createMethod(
      'createPet',
      createObjectType([
        createField('name', createPrimitiveType('string'), true),
        createField('status', createPrimitiveType('string'), false),
      ]),
      petType,
      {
        httpMethod: 'POST',
        path: '/pets',
        description: 'Create a new pet',
      }
    ),
    createMethod(
      'updatePet',
      createObjectType([
        createField('name', createPrimitiveType('string'), false),
        createField('status', createPrimitiveType('string'), false),
      ]),
      petType,
      {
        httpMethod: 'PUT',
        path: '/pets/{petId}',
        description: 'Update a pet',
        parameters: [
          createParameter('petId', createPrimitiveType('integer'), 'path', true),
        ],
      }
    ),
    createMethod(
      'deletePet',
      createVoidType(),
      createVoidType(),
      {
        httpMethod: 'DELETE',
        path: '/pets/{petId}',
        description: 'Delete a pet',
        parameters: [
          createParameter('petId', createPrimitiveType('integer'), 'path', true),
        ],
        deprecated: true,
      }
    ),
  ];

  const service = createService('Pets', methods);
  return createSchema([service], 'openapi');
}

describe('RestGenerator', () => {
  describe('Route Generation', () => {
    it('should generate routes from schema', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      expect(output.routes.length).toBe(5);
    });

    it('should convert OpenAPI path params to Fastify format', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      const getPetRoute = output.routes.find((r) => r.operationId === 'getPetById');
      expect(getPetRoute?.url).toBe('/pets/:petId');
    });

    it('should set correct HTTP methods', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      const getRoute = output.routes.find((r) => r.operationId === 'listPets');
      const postRoute = output.routes.find((r) => r.operationId === 'createPet');
      const putRoute = output.routes.find((r) => r.operationId === 'updatePet');
      const deleteRoute = output.routes.find((r) => r.operationId === 'deletePet');

      expect(getRoute?.method).toBe('GET');
      expect(postRoute?.method).toBe('POST');
      expect(putRoute?.method).toBe('PUT');
      expect(deleteRoute?.method).toBe('DELETE');
    });

    it('should include description and deprecation info', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      const listRoute = output.routes.find((r) => r.operationId === 'listPets');
      const deleteRoute = output.routes.find((r) => r.operationId === 'deletePet');

      expect(listRoute?.description).toBe('List all pets');
      expect(deleteRoute?.deprecated).toBe(true);
    });

    it('should apply prefix to routes', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator({ prefix: '/api/v1' });
      const output = generator.generate(schema);

      for (const route of output.routes) {
        expect(route.url.startsWith('/api/v1')).toBe(true);
      }
    });

    it('should strip base path when configured', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator({ stripBasePath: '/pets' });
      const output = generator.generate(schema);

      const listRoute = output.routes.find((r) => r.operationId === 'listPets');
      expect(listRoute?.url).toBe('/');
    });
  });

  describe('JSON Schema Generation', () => {
    it('should generate JSON schema for params', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator({ generateJsonSchema: true });
      const output = generator.generate(schema);

      const getRoute = output.routes.find((r) => r.operationId === 'getPetById');
      expect(getRoute?.schema.params).toBeDefined();
      expect(getRoute?.schema.params?.properties).toHaveProperty('petId');
    });

    it('should generate JSON schema for querystring', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator({ generateJsonSchema: true });
      const output = generator.generate(schema);

      const listRoute = output.routes.find((r) => r.operationId === 'listPets');
      expect(listRoute?.schema.querystring).toBeDefined();
      expect(listRoute?.schema.querystring?.properties).toHaveProperty('limit');
      expect(listRoute?.schema.querystring?.properties).toHaveProperty('status');
    });

    it('should generate JSON schema for body', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator({ generateJsonSchema: true });
      const output = generator.generate(schema);

      const postRoute = output.routes.find((r) => r.operationId === 'createPet');
      expect(postRoute?.schema.body).toBeDefined();
      expect(postRoute?.schema.body?.properties).toHaveProperty('name');
    });

    it('should generate response schema when enabled', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator({
        generateJsonSchema: true,
        includeResponseSchemas: true,
      });
      const output = generator.generate(schema);

      const listRoute = output.routes.find((r) => r.operationId === 'listPets');
      expect(listRoute?.schema.response?.[200]).toBeDefined();
    });

    it('should skip schema generation when disabled', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator({ generateJsonSchema: false });
      const output = generator.generate(schema);

      const listRoute = output.routes.find((r) => r.operationId === 'listPets');
      expect(Object.keys(listRoute?.schema ?? {})).toHaveLength(0);
    });
  });

  describe('Handler Types Generation', () => {
    it('should generate TypeScript handler types', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      expect(output.handlerTypes).toContain('export type');
      expect(output.handlerTypes).toContain('FastifyRequest');
      expect(output.handlerTypes).toContain('FastifyReply');
    });

    it('should generate RouteHandlers interface', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      expect(output.handlerTypes).toContain('export interface RouteHandlers');
    });

    it('should include JSDoc comments for deprecated routes', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      expect(output.handlerTypes).toContain('@deprecated');
    });
  });

  describe('Plugin Code Generation', () => {
    it('should generate Fastify plugin code', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      expect(output.pluginCode).toContain('export async function restPlugin');
      expect(output.pluginCode).toContain('fastify.route');
    });

    it('should include all routes in plugin', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      expect(output.pluginCode).toContain("method: 'GET'");
      expect(output.pluginCode).toContain("method: 'POST'");
      expect(output.pluginCode).toContain("method: 'PUT'");
      expect(output.pluginCode).toContain("method: 'DELETE'");
    });
  });

  describe('Registration Code Generation', () => {
    it('should generate route registration code', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator();
      const output = generator.generate(schema);

      expect(output.registrationCode).toContain('export const routeConfigs');
      expect(output.registrationCode).toContain('listPets');
      expect(output.registrationCode).toContain('getPetById');
    });
  });

  describe('Custom Handler Name Generator', () => {
    it('should use custom handler name generator', () => {
      const schema = createTestSchema();
      const generator = new RestGenerator({
        handlerNameGenerator: (method, service): string =>
          `handle_${service.name}_${method.name}`,
      });
      const output = generator.generate(schema);

      const route = output.routes[0];
      expect(route?.handlerName).toBe('handle_Pets_listPets');
    });
  });
});

describe('generateRestRoutes', () => {
  it('should generate REST output as a convenience function', () => {
    const schema = createTestSchema();
    const output = generateRestRoutes(schema);

    expect(output.routes).toBeDefined();
    expect(output.handlerTypes).toBeDefined();
    expect(output.pluginCode).toBeDefined();
    expect(output.registrationCode).toBeDefined();
  });
});

describe('generateRouteConfigs', () => {
  it('should generate only route configs', () => {
    const schema = createTestSchema();
    const configs = generateRouteConfigs(schema);

    expect(Array.isArray(configs)).toBe(true);
    expect(configs.length).toBe(5);
    configs.forEach((config) => {
      expect(config).toHaveProperty('method');
      expect(config).toHaveProperty('url');
      expect(config).toHaveProperty('operationId');
    });
  });
});

describe('Edge Cases', () => {
  it('should handle schema with no methods', () => {
    const service = createService('Empty', []);
    const schema = createSchema([service], 'openapi');
    const generator = new RestGenerator();
    const output = generator.generate(schema);

    expect(output.routes).toHaveLength(0);
  });

  it('should handle methods without path', () => {
    const method = createMethod(
      'noPath',
      createVoidType(),
      createVoidType(),
      { httpMethod: 'GET' }
    );
    const service = createService('Test', [method]);
    const schema = createSchema([service], 'openapi');
    const generator = new RestGenerator();
    const output = generator.generate(schema);

    // Methods without path should be skipped
    expect(output.routes).toHaveLength(0);
  });

  it('should handle methods without HTTP method', () => {
    const method = createMethod(
      'noHttpMethod',
      createVoidType(),
      createVoidType(),
      { path: '/test' }
    );
    const service = createService('Test', [method]);
    const schema = createSchema([service], 'openapi');
    const generator = new RestGenerator();
    const output = generator.generate(schema);

    // Methods without HTTP method should be skipped
    expect(output.routes).toHaveLength(0);
  });
});
