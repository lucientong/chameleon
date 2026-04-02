/**
 * GraphQL Generator Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OpenAPIParser } from '../../src/parsers/openapi.js';
import {
  GraphQLGenerator,
  generateGraphQL,
  generateGraphQLTypeDefs,
} from '../../src/generators/graphql-generator.js';
import {
  createSchema,
  createService,
  createMethod,
  createObjectType,
  createArrayType,
  createPrimitiveType,
  createEnumType,
  createUnionType,
  createField,
  createVoidType,
  createParameter,
  type IRSchema,
  type IRService,
} from '../../src/parsers/ir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '..', 'fixtures');

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestSchema(): IRSchema {
  const petType = createObjectType(
    [
      createField('id', createPrimitiveType('integer'), true, { description: 'Pet ID' }),
      createField('name', createPrimitiveType('string'), true, { description: 'Pet name' }),
      createField('status', createEnumType(['available', 'pending', 'sold'], { name: 'PetStatus' }), true),
    ],
    { name: 'Pet', description: 'A pet in the store' }
  );

  const petListType = createObjectType(
    [
      createField('items', createArrayType(petType), true),
      createField('total', createPrimitiveType('integer'), true),
    ],
    { name: 'PetList' }
  );

  const createPetInput = createObjectType(
    [
      createField('name', createPrimitiveType('string'), true),
      createField('status', createEnumType(['available', 'pending', 'sold'], { name: 'PetStatus' }), false),
    ],
    { name: 'CreatePetRequest' }
  );

  const petService: IRService = createService('pets', [
    createMethod('listPets', createVoidType(), petListType, {
      description: 'List all pets',
      httpMethod: 'GET',
      path: '/pets',
      parameters: [
        createParameter('limit', createPrimitiveType('integer'), 'query', false, {
          description: 'Maximum number of pets to return',
        }),
        createParameter('status', createEnumType(['available', 'pending', 'sold'], { name: 'PetStatus' }), 'query', false),
      ],
    }),
    createMethod('getPetById', createVoidType(), petType, {
      description: 'Get a pet by ID',
      httpMethod: 'GET',
      path: '/pets/{petId}',
      parameters: [
        createParameter('petId', createPrimitiveType('integer'), 'path', true, {
          description: 'Pet ID',
        }),
      ],
    }),
    createMethod('createPet', createPetInput, petType, {
      description: 'Create a new pet',
      httpMethod: 'POST',
      path: '/pets',
    }),
    createMethod('deletePet', createVoidType(), createVoidType(), {
      description: 'Delete a pet',
      httpMethod: 'DELETE',
      path: '/pets/{petId}',
      parameters: [
        createParameter('petId', createPrimitiveType('integer'), 'path', true),
      ],
    }),
  ]);

  return createSchema([petService], 'openapi', { sourceVersion: '3.0.0' });
}

// ============================================================================
// GraphQL Generator Tests
// ============================================================================

describe('GraphQLGenerator', () => {
  describe('generate()', () => {
    it('should generate GraphQL SDL from IR schema', () => {
      const schema = createTestSchema();
      const generator = new GraphQLGenerator();
      const output = generator.generate(schema);

      expect(output.typeDefs).toBeDefined();
      expect(output.typeDefs).toContain('type Query');
      expect(output.typeDefs).toContain('type Mutation');
    });

    it('should map GET methods to Query', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema);

      // listPets and getPetById should be queries (GET methods)
      expect(output.typeDefs).toMatch(/type Query \{[\s\S]*listPets/);
      expect(output.typeDefs).toMatch(/type Query \{[\s\S]*getPetById/);
    });

    it('should map POST/DELETE methods to Mutation', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema);

      // createPet and deletePet should be mutations
      expect(output.typeDefs).toMatch(/type Mutation \{[\s\S]*createPet/);
      expect(output.typeDefs).toMatch(/type Mutation \{[\s\S]*deletePet/);
    });

    it('should generate object types', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema);

      expect(output.typeDefs).toContain('type Pet');
      expect(output.typeDefs).toContain('type PetList');
    });

    it('should generate enum types', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema);

      expect(output.typeDefs).toContain('enum PetStatus');
      expect(output.typeDefs).toContain('AVAILABLE');
      expect(output.typeDefs).toContain('PENDING');
      expect(output.typeDefs).toContain('SOLD');
    });

    it('should generate input types for mutations', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema);

      expect(output.typeDefs).toContain('input CreatePetRequestInput');
    });

    it('should include method descriptions as documentation', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema, { includeDescriptions: true });

      expect(output.typeDefs).toContain('List all pets');
      expect(output.typeDefs).toContain('Get a pet by ID');
    });

    it('should generate method arguments from parameters', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema);

      // listPets should have limit and status parameters
      expect(output.typeDefs).toMatch(/listPets\([^)]*limit: Int/);
      expect(output.typeDefs).toMatch(/listPets\([^)]*status: PetStatus/);

      // getPetById should have petId parameter
      expect(output.typeDefs).toMatch(/getPetById\([^)]*petId: Int!/);
    });

    it('should create resolver stubs', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema);

      expect(output.resolvers).toBeDefined();
      expect(output.resolvers.Query).toBeDefined();
      expect(output.resolvers.Mutation).toBeDefined();
      expect(output.resolvers.Query?.listPets).toBeTypeOf('function');
      expect(output.resolvers.Mutation?.createPet).toBeTypeOf('function');
    });

    it('should create operation map', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema);

      expect(output.operationMap.size).toBe(4); // listPets, getPetById, createPet, deletePet
      expect(output.operationMap.get('listPets')).toBeDefined();
      expect(output.operationMap.get('listPets')?.operationType).toBe('Query');
      expect(output.operationMap.get('createPet')?.operationType).toBe('Mutation');
    });
  });

  describe('type conversion', () => {
    it('should convert primitive types correctly', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod(
              'testMethod',
              createVoidType(),
              createObjectType([
                createField('strField', createPrimitiveType('string'), true),
                createField('intField', createPrimitiveType('integer'), true),
                createField('numField', createPrimitiveType('number'), true),
                createField('boolField', createPrimitiveType('boolean'), true),
              ]),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateGraphQL(schema);

      expect(output.typeDefs).toContain('strField: String!');
      expect(output.typeDefs).toContain('intField: Int!');
      expect(output.typeDefs).toContain('numField: Float!');
      expect(output.typeDefs).toContain('boolField: Boolean!');
    });

    it('should convert array types correctly', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod(
              'testMethod',
              createVoidType(),
              createObjectType([
                createField('items', createArrayType(createPrimitiveType('string')), true),
              ]),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateGraphQL(schema);

      expect(output.typeDefs).toContain('items: [String]!');
    });

    it('should convert union types', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod(
              'testMethod',
              createVoidType(),
              createUnionType(
                [
                  createObjectType([createField('a', createPrimitiveType('string'), true)], { name: 'TypeA' }),
                  createObjectType([createField('b', createPrimitiveType('string'), true)], { name: 'TypeB' }),
                ],
                { name: 'ResultUnion' }
              ),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateGraphQL(schema);

      expect(output.typeDefs).toContain('union ResultUnion = TypeA | TypeB');
    });

    it('should handle format-based scalar mapping', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod(
              'testMethod',
              createVoidType(),
              createObjectType([
                createField('dateTime', createPrimitiveType('string', { format: 'date-time' }), true),
                createField('uuid', createPrimitiveType('string', { format: 'uuid' }), true),
              ]),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateGraphQL(schema);

      expect(output.typeDefs).toContain('scalar DateTime');
      expect(output.typeDefs).toContain('dateTime: DateTime!');
      expect(output.typeDefs).toContain('uuid: ID!');
    });
  });

  describe('options', () => {
    it('should respect includeDeprecated option', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod('activeMethod', createVoidType(), createPrimitiveType('string'), { httpMethod: 'GET' }),
            createMethod('deprecatedMethod', createVoidType(), createPrimitiveType('string'), {
              httpMethod: 'GET',
              deprecated: true,
            }),
          ]),
        ],
        'openapi'
      );

      const outputWithDeprecated = generateGraphQL(schema, { includeDeprecated: true });
      const outputWithoutDeprecated = generateGraphQL(schema, { includeDeprecated: false });

      expect(outputWithDeprecated.typeDefs).toContain('deprecatedMethod');
      expect(outputWithoutDeprecated.typeDefs).not.toContain('deprecatedMethod');
    });

    it('should respect custom scalar mappings', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod(
              'testMethod',
              createVoidType(),
              createObjectType([
                createField('email', createPrimitiveType('string', { format: 'email' }), true),
              ]),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateGraphQL(schema, {
        scalarMappings: { email: 'Email' },
      });

      expect(output.typeDefs).toContain('scalar Email');
      expect(output.typeDefs).toContain('email: Email!');
    });

    it('should respect input type prefix/suffix', () => {
      const schema = createTestSchema();
      const output = generateGraphQL(schema, {
        inputTypePrefix: 'I',
        inputTypeSuffix: '',
      });

      expect(output.typeDefs).toContain('input ICreatePetRequest');
    });
  });

  describe('integration with OpenAPI parser', () => {
    let petstoreSchema: IRSchema;

    beforeAll(async () => {
      const parser = new OpenAPIParser();
      petstoreSchema = await parser.parseFile(join(fixturesDir, 'petstore.yaml'));
    });

    it('should generate GraphQL schema from parsed OpenAPI', () => {
      const output = generateGraphQL(petstoreSchema);

      expect(output.typeDefs).toBeDefined();
      expect(output.typeDefs).toContain('type Query');
      expect(output.typeDefs).toContain('type Mutation');
    });

    it('should include all operations', () => {
      const output = generateGraphQL(petstoreSchema);

      // GET operations should be queries
      expect(output.typeDefs).toContain('listPets');
      expect(output.typeDefs).toContain('getPetById');
      expect(output.typeDefs).toContain('getInventory');

      // POST/PUT/DELETE operations should be mutations
      expect(output.typeDefs).toContain('createPet');
      expect(output.typeDefs).toContain('updatePet');
      expect(output.typeDefs).toContain('deletePet');
      expect(output.typeDefs).toContain('createUser');
    });

    it('should include all types', () => {
      const output = generateGraphQL(petstoreSchema);

      expect(output.typeDefs).toContain('type Pet');
      expect(output.typeDefs).toContain('type PetList');
      expect(output.typeDefs).toContain('type Category');
      expect(output.typeDefs).toContain('type User');
      expect(output.typeDefs).toContain('type Error');
      // PetStatus enum may be inlined or have generated name from dereference
      expect(output.typeDefs).toMatch(/enum (PetStatus|Enum\d+)/);
    });

    it('should generate valid GraphQL SDL', () => {
      const output = generateGraphQL(petstoreSchema);

      // Basic syntax checks
      const typeDefs = output.typeDefs;

      // Should have balanced braces
      const openBraces = (typeDefs.match(/{/g) ?? []).length;
      const closeBraces = (typeDefs.match(/}/g) ?? []).length;
      expect(openBraces).toBe(closeBraces);

      // Should not have undefined values
      expect(typeDefs).not.toContain('undefined');
    });
  });
});

// ============================================================================
// Convenience Functions Tests
// ============================================================================

describe('generateGraphQL', () => {
  it('should be a convenience function that works', () => {
    const schema = createTestSchema();
    const output = generateGraphQL(schema);

    expect(output.typeDefs).toBeDefined();
    expect(output.resolvers).toBeDefined();
    expect(output.operationMap).toBeDefined();
  });
});

describe('generateGraphQLTypeDefs', () => {
  it('should return only type definitions string', () => {
    const schema = createTestSchema();
    const typeDefs = generateGraphQLTypeDefs(schema);

    expect(typeDefs).toBeTypeOf('string');
    expect(typeDefs).toContain('type Query');
    expect(typeDefs).toContain('type Mutation');
  });
});
