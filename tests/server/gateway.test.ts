/**
 * Tests for Chameleon Gateway
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createGateway,
  chameleonPlugin,
  type Gateway,
} from '../../src/server/gateway.js';
import {
  createPrimitiveType,
  createObjectType,
  createField,
  createMethod,
  createService,
  createSchema,
  createVoidType,
  createParameter,
  type IRSchema,
} from '../../src/parsers/ir.js';
import Fastify from 'fastify';

// Response body types
interface HealthResponse {
  status: string;
  schema: {
    sourceType: string;
    services: number;
  };
}

interface SchemaResponse {
  sourceType: string;
  services: { name: string }[];
}

interface SDLResponse {
  typeDefs: string;
}

interface PetResponse {
  id: number;
  name: string;
  status?: string;
}

interface GraphQLResponse {
  data?: {
    __schema?: { types: unknown[] };
    listPets?: PetResponse[];
    getPetById?: PetResponse;
    createPet?: PetResponse;
  };
}

// Create a test schema
function createTestSchema(): IRSchema {
  const petType = createObjectType([
    createField('id', createPrimitiveType('integer'), true),
    createField('name', createPrimitiveType('string'), true),
    createField('status', createPrimitiveType('string'), false),
  ], { name: 'Pet' });

  const methods = [
    createMethod(
      'listPets',
      createVoidType(),
      petType,
      {
        httpMethod: 'GET',
        path: '/pets',
        description: 'List all pets',
        parameters: [
          createParameter('limit', createPrimitiveType('integer'), 'query', false),
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
      ]),
      petType,
      {
        httpMethod: 'POST',
        path: '/pets',
        description: 'Create a new pet',
      }
    ),
  ];

  const service = createService('Pets', methods);
  return createSchema([service], 'openapi', { sourceVersion: '3.0.0' });
}

describe('createGateway', () => {
  let gateway: Gateway;
  const schema = createTestSchema();

  beforeAll(async () => {
    gateway = await createGateway(schema, {
      port: 0, // Random available port
      enableLogging: false,
      enableGraphQL: true,
      enableRestProxy: true,
      cors: false as unknown as undefined, // Disable CORS for testing
      translatorOptions: {
        backendHandler: (ctx) => {
          // Mock backend handler
          if (ctx.method.name === 'listPets') {
            return Promise.resolve({
              statusCode: 200,
              body: [{ id: 1, name: 'Fluffy', status: 'available' }],
            });
          }
          if (ctx.method.name === 'getPetById') {
            const petId = ctx.pathParams.petId;
            return Promise.resolve({
              statusCode: 200,
              body: { id: Number(petId), name: 'Buddy', status: 'available' },
            });
          }
          if (ctx.method.name === 'createPet') {
            return Promise.resolve({
              statusCode: 201,
              body: { id: 123, name: (ctx.body as { name: string }).name, status: 'available' },
            });
          }
          return Promise.resolve({ statusCode: 404, body: { error: 'Not found' } });
        },
      },
    });
    await gateway.start();
  });

  afterAll(async () => {
    if (gateway) {
      await gateway.stop();
    }
  });

  describe('Gateway Instance', () => {
    it('should create gateway with Fastify app', () => {
      expect(gateway.app).toBeDefined();
    });

    it('should create gateway with translator', () => {
      expect(gateway.translator).toBeDefined();
    });

    it('should create gateway with GraphQL output', () => {
      expect(gateway.graphqlOutput).toBeDefined();
      expect(gateway.graphqlOutput?.typeDefs).toBeDefined();
    });

    it('should return server address', () => {
      const address = gateway.getAddress();
      expect(address).toMatch(/^http:\/\//);
    });
  });

  describe('Health Check', () => {
    it('should respond to health check', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as HealthResponse;
      expect(body.status).toBe('healthy');
      expect(body.schema).toBeDefined();
      expect(body.schema.sourceType).toBe('openapi');
    });
  });

  describe('Schema Introspection', () => {
    it('should expose schema endpoint', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/_schema',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SchemaResponse;
      expect(body.sourceType).toBe('openapi');
      expect(body.services).toHaveLength(1);
      expect(body.services[0]?.name).toBe('Pets');
    });

    it('should expose GraphQL SDL endpoint', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/_graphql/sdl',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as SDLResponse;
      expect(body.typeDefs).toBeDefined();
      expect(body.typeDefs).toContain('type Query');
    });
  });

  describe('REST Proxy', () => {
    it('should proxy GET requests', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/pets',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as PetResponse[];
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toHaveProperty('name', 'Fluffy');
    });

    it('should proxy GET requests with path params', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/pets/42',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as PetResponse;
      expect(body.id).toBe(42);
    });

    it('should proxy POST requests', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/api/pets',
        headers: { 'Content-Type': 'application/json' },
        payload: { name: 'NewPet' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as PetResponse;
      expect(body.name).toBe('NewPet');
    });
  });

  describe('GraphQL Endpoint', () => {
    it('should respond to GraphQL introspection', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/graphql',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          query: '{ __schema { types { name } } }',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as GraphQLResponse;
      expect(body.data?.__schema?.types).toBeDefined();
    });

    it('should execute queries', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/graphql',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          query: '{ listPets { id name } }',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as GraphQLResponse;
      expect(body.data?.listPets).toBeDefined();
    });

    it('should execute queries with variables', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/graphql',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          query: 'query GetPet($id: Int!) { getPetById(petId: $id) { id name } }',
          variables: { id: 42 },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as GraphQLResponse;
      expect(body.data?.getPetById?.id).toBe(42);
    });

    it('should execute mutations', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/graphql',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          query: 'mutation { createPet(input: { name: "GraphQLPet" }) { id name } }',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as GraphQLResponse;
      expect(body.data?.createPet?.name).toBe('GraphQLPet');
    });
  });
});

describe('Gateway Configuration', () => {
  it('should disable GraphQL when configured', async () => {
    const schema = createTestSchema();
    const gateway = await createGateway(schema, {
      port: 0,
      enableLogging: false,
      enableGraphQL: false,
      enableRestProxy: true,
    });

    // GraphQL output should not be generated
    expect(gateway.graphqlOutput).toBeUndefined();

    await gateway.stop();
  });

  it('should disable REST proxy when configured', async () => {
    const schema = createTestSchema();
    const gateway = await createGateway(schema, {
      port: 0,
      enableLogging: false,
      enableGraphQL: true,
      enableRestProxy: false,
    });

    await gateway.start();

    // REST endpoint should not exist
    const response = await gateway.app.inject({
      method: 'GET',
      url: '/api/pets',
    });

    expect(response.statusCode).toBe(404);

    await gateway.stop();
  });

  it('should use custom paths', async () => {
    const schema = createTestSchema();
    const gateway = await createGateway(schema, {
      port: 0,
      enableLogging: false,
      graphqlPath: '/custom-graphql',
      restProxyPath: '/custom-api',
      healthCheckPath: '/custom-health',
      translatorOptions: {
        backendHandler: () => Promise.resolve({ statusCode: 200, body: [] }),
      },
    });

    await gateway.start();

    // Custom health path
    const healthResponse = await gateway.app.inject({
      method: 'GET',
      url: '/custom-health',
    });
    expect(healthResponse.statusCode).toBe(200);

    // Custom REST path
    const restResponse = await gateway.app.inject({
      method: 'GET',
      url: '/custom-api/pets',
    });
    expect(restResponse.statusCode).toBe(200);

    await gateway.stop();
  });
});

describe('chameleonPlugin', () => {
  it('should register as Fastify plugin', async () => {
    const schema = createTestSchema();
    const app = Fastify({ logger: false });

    await app.register(chameleonPlugin, {
      schema,
      gatewayOptions: {
        translatorOptions: {
          backendHandler: () => Promise.resolve({ statusCode: 200, body: [] }),
        },
      },
    });

    await app.ready();

    // Check if translator is decorated
    expect(app.chameleonTranslator).toBeDefined();

    // Check if GraphQL endpoint is registered
    const response = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'Content-Type': 'application/json' },
      payload: { query: '{ __typename }' },
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('should respect plugin gateway options', async () => {
    const schema = createTestSchema();
    const app = Fastify({ logger: false });

    await app.register(chameleonPlugin, {
      schema,
      gatewayOptions: {
        graphqlPath: '/my-graphql',
        restProxyPath: '/my-api',
        translatorOptions: {
          backendHandler: () => Promise.resolve({ statusCode: 200, body: [] }),
        },
      },
    });

    await app.ready();

    // Custom GraphQL path
    const graphqlResponse = await app.inject({
      method: 'POST',
      url: '/my-graphql',
      headers: { 'Content-Type': 'application/json' },
      payload: { query: '{ __typename }' },
    });
    expect(graphqlResponse.statusCode).toBe(200);

    // Custom REST path
    const restResponse = await app.inject({
      method: 'GET',
      url: '/my-api/pets',
    });
    expect(restResponse.statusCode).toBe(200);

    await app.close();
  });
});
