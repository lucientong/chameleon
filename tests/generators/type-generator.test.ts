/**
 * TypeScript Type Generator Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OpenAPIParser } from '../../src/parsers/openapi.js';
import {
  TypeGenerator,
  generateTypeScript,
  generateTypeScriptCode,
} from '../../src/generators/type-generator.js';
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
      createField('tags', createArrayType(createPrimitiveType('string')), false),
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
        createParameter('petId', createPrimitiveType('integer'), 'path', true),
      ],
    }),
    createMethod('createPet', createPetInput, petType, {
      description: 'Create a new pet',
      httpMethod: 'POST',
      path: '/pets',
    }),
  ]);

  return createSchema([petService], 'openapi', { sourceVersion: '3.0.0' });
}

// ============================================================================
// TypeGenerator Tests
// ============================================================================

describe('TypeGenerator', () => {
  describe('generate()', () => {
    it('should generate TypeScript types from IR schema', () => {
      const schema = createTestSchema();
      const generator = new TypeGenerator();
      const output = generator.generate(schema);

      expect(output.code).toBeDefined();
      expect(output.typeMap.size).toBeGreaterThan(0);
      expect(output.typeNames.length).toBeGreaterThan(0);
    });

    it('should generate interface definitions', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema);

      expect(output.code).toContain('interface Pet');
      expect(output.code).toContain('interface PetList');
      expect(output.code).toContain('interface CreatePetRequest');
    });

    it('should generate enum definitions', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema);

      expect(output.code).toContain('enum PetStatus');
      expect(output.code).toContain("available = 'available'");
      expect(output.code).toContain("pending = 'pending'");
      expect(output.code).toContain("sold = 'sold'");
    });

    it('should handle required and optional fields', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema);

      // Required fields should not have ?
      expect(output.code).toMatch(/id: number;/);
      expect(output.code).toMatch(/name: string;/);

      // Optional fields should have ?
      expect(output.code).toMatch(/tags\?: string\[\];/);
    });

    it('should generate JSDoc comments', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema, { includeComments: true });

      expect(output.code).toContain('A pet in the store');
      expect(output.code).toContain('Pet ID');
    });

    it('should export types by default', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema);

      expect(output.code).toContain('export interface Pet');
      expect(output.code).toContain('export enum PetStatus');
    });

    it('should generate service interfaces when enabled', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema, { generateMethods: true });

      expect(output.code).toContain('interface petsService');
      expect(output.code).toContain('listPets');
      expect(output.code).toContain('getPetById');
      expect(output.code).toContain('createPet');
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
              createObjectType(
                [
                  createField('strField', createPrimitiveType('string'), true),
                  createField('intField', createPrimitiveType('integer'), true),
                  createField('numField', createPrimitiveType('number'), true),
                  createField('boolField', createPrimitiveType('boolean'), true),
                ],
                { name: 'TestOutput' }
              ),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateTypeScript(schema);

      expect(output.code).toContain('strField: string;');
      expect(output.code).toContain('intField: number;');
      expect(output.code).toContain('numField: number;');
      expect(output.code).toContain('boolField: boolean;');
    });

    it('should convert array types correctly', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod(
              'testMethod',
              createVoidType(),
              createObjectType(
                [
                  createField('items', createArrayType(createPrimitiveType('string')), true),
                  createField('nested', createArrayType(createArrayType(createPrimitiveType('number'))), true),
                ],
                { name: 'ArrayTestOutput' }
              ),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateTypeScript(schema);

      expect(output.code).toContain('items: string[];');
      expect(output.code).toContain('nested: number[][];');
    });

    it('should convert union types correctly', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod(
              'testMethod',
              createVoidType(),
              createObjectType(
                [
                  createField(
                    'result',
                    createUnionType(
                      [createPrimitiveType('string'), createPrimitiveType('number')],
                      { name: 'StringOrNumber' }
                    ),
                    true
                  ),
                ],
                { name: 'UnionTestOutput' }
              ),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateTypeScript(schema);

      expect(output.code).toContain('type StringOrNumber = string | number');
      expect(output.code).toContain('result: StringOrNumber;');
    });

    it('should handle inline anonymous types', () => {
      const generator = new TypeGenerator();

      // Test inline object type
      const inlineObject = createObjectType([
        createField('a', createPrimitiveType('string'), true),
        createField('b', createPrimitiveType('number'), false),
      ]);

      const typeStr = generator.convertType(inlineObject);
      expect(typeStr).toContain('a: string');
      expect(typeStr).toContain('b?: number');
    });
  });

  describe('options', () => {
    it('should respect useTypeAlias option', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema, { useTypeAlias: true });

      expect(output.code).toContain('export type Pet = {');
      expect(output.code).not.toContain('export interface Pet');
    });

    it('should respect readonly option', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema, { readonly: true });

      expect(output.code).toContain('readonly id: number;');
      expect(output.code).toContain('readonly name: string;');
    });

    it('should respect enumAsConst option', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema, { enumAsConst: true });

      expect(output.code).toContain('const PetStatus = {');
      expect(output.code).toContain('} as const');
      expect(output.code).toContain('type PetStatus = (typeof PetStatus)[keyof typeof PetStatus]');
    });

    it('should respect exportTypes option', () => {
      const schema = createTestSchema();
      const outputWithExport = generateTypeScript(schema, { exportTypes: true });
      const outputWithoutExport = generateTypeScript(schema, { exportTypes: false });

      expect(outputWithExport.code).toContain('export interface Pet');
      expect(outputWithoutExport.code).toContain('interface Pet');
      expect(outputWithoutExport.code).not.toMatch(/^export interface Pet/m);
    });

    it('should respect custom indent', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema, { indent: '    ' }); // 4 spaces

      expect(output.code).toContain('    id: number;');
    });

    it('should respect type prefix/suffix', () => {
      const schema = createTestSchema();
      const output = generateTypeScript(schema, {
        typePrefix: 'I',
        typeSuffix: 'Type',
      });

      expect(output.code).toContain('interface IPetType');
      expect(output.code).toContain('interface IPetListType');
    });

    it('should respect format type mappings', () => {
      const schema = createSchema(
        [
          createService('test', [
            createMethod(
              'testMethod',
              createVoidType(),
              createObjectType(
                [
                  createField('dateTime', createPrimitiveType('string', { format: 'date-time' }), true),
                  createField('binary', createPrimitiveType('string', { format: 'binary' }), true),
                ],
                { name: 'FormatTestOutput' }
              ),
              { httpMethod: 'GET' }
            ),
          ]),
        ],
        'openapi'
      );

      const output = generateTypeScript(schema);

      expect(output.code).toContain('dateTime: string;'); // date-time maps to string by default
      expect(output.code).toContain('binary: Blob | ArrayBuffer;');
    });
  });

  describe('integration with OpenAPI parser', () => {
    let petstoreSchema: IRSchema;

    beforeAll(async () => {
      const parser = new OpenAPIParser();
      petstoreSchema = await parser.parseFile(join(fixturesDir, 'petstore.yaml'));
    });

    it('should generate TypeScript types from parsed OpenAPI', () => {
      const output = generateTypeScript(petstoreSchema);

      expect(output.code).toBeDefined();
      expect(output.code.length).toBeGreaterThan(0);
    });

    it('should include all types', () => {
      const output = generateTypeScript(petstoreSchema);

      expect(output.code).toContain('interface Pet');
      expect(output.code).toContain('interface PetList');
      expect(output.code).toContain('interface Category');
      expect(output.code).toContain('interface User');
      expect(output.code).toContain('interface Error');
      // PetStatus enum is inlined as union type after dereference
      // Check that enum values are present in status fields
      expect(output.code).toContain("'available'");
      expect(output.code).toContain("'pending'");
      expect(output.code).toContain("'sold'");
    });

    it('should generate valid TypeScript syntax', () => {
      const output = generateTypeScript(petstoreSchema);
      const code = output.code;

      // Should have balanced braces
      const openBraces = (code.match(/{/g) ?? []).length;
      const closeBraces = (code.match(/}/g) ?? []).length;
      expect(openBraces).toBe(closeBraces);

      // Should not have undefined values in type annotations
      expect(code).not.toContain(': undefined;');
    });

    it('should generate service interfaces', () => {
      const output = generateTypeScript(petstoreSchema, { generateMethods: true });

      // Should have service interfaces for each tag-based service
      expect(output.code).toContain('Service');
      expect(output.code).toContain('listPets');
      expect(output.code).toContain('createPet');
    });
  });
});

// ============================================================================
// Convenience Functions Tests
// ============================================================================

describe('generateTypeScript', () => {
  it('should be a convenience function that works', () => {
    const schema = createTestSchema();
    const output = generateTypeScript(schema);

    expect(output.code).toBeDefined();
    expect(output.typeMap).toBeDefined();
    expect(output.typeNames).toBeDefined();
  });
});

describe('generateTypeScriptCode', () => {
  it('should return only code string', () => {
    const schema = createTestSchema();
    const code = generateTypeScriptCode(schema);

    expect(code).toBeTypeOf('string');
    expect(code).toContain('interface Pet');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('should handle empty schema', () => {
    const schema = createSchema([], 'openapi');
    const output = generateTypeScript(schema);

    expect(output.code).toBeDefined();
    expect(output.typeNames.length).toBe(0);
  });

  it('should handle deeply nested types', () => {
    const deeplyNested = createObjectType(
      [
        createField(
          'level1',
          createObjectType(
            [
              createField(
                'level2',
                createObjectType(
                  [
                    createField('level3', createPrimitiveType('string'), true),
                  ],
                  { name: 'Level3Type' }
                ),
                true
              ),
            ],
            { name: 'Level2Type' }
          ),
          true
        ),
      ],
      { name: 'Level1Type' }
    );

    const schema = createSchema(
      [
        createService('test', [
          createMethod('getDeep', createVoidType(), deeplyNested, { httpMethod: 'GET' }),
        ]),
      ],
      'openapi'
    );

    const output = generateTypeScript(schema);

    expect(output.code).toContain('interface Level1Type');
    expect(output.code).toContain('interface Level2Type');
    expect(output.code).toContain('interface Level3Type');
  });

  it('should handle numeric enum values', () => {
    const numericEnum = createEnumType([0, 1, 2], { name: 'StatusCode' });
    const schema = createSchema(
      [
        createService('test', [
          createMethod(
            'getStatus',
            createVoidType(),
            createObjectType([createField('status', numericEnum, true)], { name: 'StatusOutput' }),
            { httpMethod: 'GET' }
          ),
        ]),
      ],
      'openapi'
    );

    const output = generateTypeScript(schema);

    expect(output.code).toContain('enum StatusCode');
    expect(output.code).toContain('Value0 = 0');
    expect(output.code).toContain('Value1 = 1');
    expect(output.code).toContain('Value2 = 2');
  });

  it('should handle special characters in names', () => {
    const schema = createSchema(
      [
        createService('test', [
          createMethod(
            'getSpecial',
            createVoidType(),
            createObjectType(
              [
                createField('kebab-case', createPrimitiveType('string'), true),
                createField('with spaces', createPrimitiveType('string'), true),
              ],
              { name: 'SpecialOutput' }
            ),
            { httpMethod: 'GET' }
          ),
        ]),
      ],
      'openapi'
    );

    const output = generateTypeScript(schema);

    // The generator should preserve field names (they might need quoting in actual TS)
    expect(output.code).toContain('SpecialOutput');
  });
});
