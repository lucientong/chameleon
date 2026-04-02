/**
 * Tests for OpenAPI 3.x Parser
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  OpenAPIParser,
  parseOpenAPIFile,
  parseOpenAPIDocument,
} from '../../src/parsers/openapi.js';
import { ParserError } from '../../src/errors.js';
import type { IRSchema, IRService } from '../../src/parsers/ir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PETSTORE_PATH = join(__dirname, '../fixtures/petstore.yaml');
const INVALID_PATH = join(__dirname, '../fixtures/invalid.yaml');

describe('OpenAPIParser', () => {
  describe('parseFile', () => {
    let schema: IRSchema;

    beforeAll(async () => {
      schema = await parseOpenAPIFile(PETSTORE_PATH);
    });

    it('should parse the petstore schema', () => {
      expect(schema).toBeDefined();
      expect(schema.sourceType).toBe('openapi');
      expect(schema.sourceVersion).toBe('3.0.3');
    });

    it('should extract schema metadata', () => {
      expect(schema.title).toBe('Petstore API');
      expect(schema.version).toBe('1.0.0');
      expect(schema.description).toContain('Pet Store API');
    });

    it('should create services from tags', () => {
      expect(schema.services.length).toBeGreaterThan(0);
      
      const serviceNames = schema.services.map(s => s.name);
      expect(serviceNames).toContain('pets');
      expect(serviceNames).toContain('store');
      expect(serviceNames).toContain('users');
    });

    describe('pets service', () => {
      let petsService: IRService | undefined;

      beforeAll(() => {
        petsService = schema.services.find(s => s.name === 'pets');
      });

      it('should have the pets service', () => {
        expect(petsService).toBeDefined();
      });

      it('should have listPets method', () => {
        const method = petsService?.methods.find(m => m.name === 'listPets');
        expect(method).toBeDefined();
        expect(method?.httpMethod).toBe('GET');
        expect(method?.path).toBe('/pets');
      });

      it('should have createPet method', () => {
        const method = petsService?.methods.find(m => m.name === 'createPet');
        expect(method).toBeDefined();
        expect(method?.httpMethod).toBe('POST');
        expect(method?.path).toBe('/pets');
      });

      it('should have getPetById method', () => {
        const method = petsService?.methods.find(m => m.name === 'getPetById');
        expect(method).toBeDefined();
        expect(method?.httpMethod).toBe('GET');
        expect(method?.path).toBe('/pets/{petId}');
      });

      it('should have updatePet method', () => {
        const method = petsService?.methods.find(m => m.name === 'updatePet');
        expect(method).toBeDefined();
        expect(method?.httpMethod).toBe('PUT');
      });

      it('should have deletePet method', () => {
        const method = petsService?.methods.find(m => m.name === 'deletePet');
        expect(method).toBeDefined();
        expect(method?.httpMethod).toBe('DELETE');
      });
    });

    describe('method parameters', () => {
      it('should parse path parameters', () => {
        const petsService = schema.services.find(s => s.name === 'pets');
        const getMethod = petsService?.methods.find(m => m.name === 'getPetById');

        expect(getMethod?.parameters).toBeDefined();
        const petIdParam = getMethod?.parameters?.find(p => p.name === 'petId');
        expect(petIdParam).toBeDefined();
        expect(petIdParam?.location).toBe('path');
        expect(petIdParam?.required).toBe(true);
      });

      it('should parse query parameters', () => {
        const petsService = schema.services.find(s => s.name === 'pets');
        const listMethod = petsService?.methods.find(m => m.name === 'listPets');

        expect(listMethod?.parameters).toBeDefined();
        const limitParam = listMethod?.parameters?.find(p => p.name === 'limit');
        expect(limitParam).toBeDefined();
        expect(limitParam?.location).toBe('query');
        expect(limitParam?.required).toBe(false);
      });
    });

    describe('type conversion', () => {
      it('should convert object types', () => {
        const petsService = schema.services.find(s => s.name === 'pets');
        const getMethod = petsService?.methods.find(m => m.name === 'getPetById');

        expect(getMethod?.output.kind).toBe('object');
      });

      it('should convert array types', () => {
        const petsService = schema.services.find(s => s.name === 'pets');
        const listMethod = petsService?.methods.find(m => m.name === 'listPets');

        // PetList has an items field that is an array
        if (listMethod?.output.kind === 'object') {
          const itemsField = listMethod.output.fields.find(f => f.name === 'items');
          expect(itemsField?.type.kind).toBe('array');
        }
      });

      it('should convert enum types', () => {
        // PetStatus is an enum
        const types = schema.types;
        if (types) {
          const petStatus = types.get('PetStatus');
          expect(petStatus?.kind).toBe('enum');
          if (petStatus?.kind === 'enum') {
            expect(petStatus.values).toContain('available');
            expect(petStatus.values).toContain('pending');
            expect(petStatus.values).toContain('sold');
          }
        }
      });

      it('should handle void output for DELETE', () => {
        const petsService = schema.services.find(s => s.name === 'pets');
        const deleteMethod = petsService?.methods.find(m => m.name === 'deletePet');

        expect(deleteMethod?.output.kind).toBe('void');
      });
    });

    describe('named types', () => {
      it('should extract named types from components/schemas', () => {
        expect(schema.types).toBeDefined();
        expect(schema.types?.size).toBeGreaterThan(0);
      });

      it('should include Pet schema', () => {
        const petType = schema.types?.get('Pet');
        expect(petType).toBeDefined();
        expect(petType?.kind).toBe('object');
      });

      it('should include Error schema', () => {
        const errorType = schema.types?.get('Error');
        expect(errorType).toBeDefined();
        expect(errorType?.kind).toBe('object');
      });
    });
  });

  describe('parseDocument', () => {
    it('should parse from a JavaScript object', async () => {
      const doc = {
        openapi: '3.0.0',
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
        paths: {
          '/test': {
            get: {
              operationId: 'testOperation',
              responses: {
                '200': {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          message: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const schema = await parseOpenAPIDocument(doc);

      expect(schema.sourceType).toBe('openapi');
      expect(schema.title).toBe('Test API');
      expect(schema.services).toHaveLength(1);
      expect(schema.services[0]?.methods[0]?.name).toBe('testOperation');
    });
  });

  describe('options', () => {
    it('should use custom default service name', async () => {
      const doc = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const schema = await parseOpenAPIDocument(doc, {
        defaultServiceName: 'CustomService',
      });

      expect(schema.services[0]?.name).toBe('CustomService');
    });

    it('should exclude deprecated operations when configured', async () => {
      const doc = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              operationId: 'activeOp',
              responses: { '200': { description: 'OK' } },
            },
            post: {
              operationId: 'deprecatedOp',
              deprecated: true,
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const schemaWithDeprecated = await parseOpenAPIDocument(doc, {
        includeDeprecated: true,
      });
      const schemaWithoutDeprecated = await parseOpenAPIDocument(doc, {
        includeDeprecated: false,
      });

      expect(schemaWithDeprecated.services[0]?.methods).toHaveLength(2);
      expect(schemaWithoutDeprecated.services[0]?.methods).toHaveLength(1);
      expect(schemaWithoutDeprecated.services[0]?.methods[0]?.name).toBe('activeOp');
    });
  });

  describe('method name generation', () => {
    it('should use operationId when available', async () => {
      const doc = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'listAllUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const schema = await parseOpenAPIDocument(doc);
      expect(schema.services[0]?.methods[0]?.name).toBe('listAllUsers');
    });

    it('should generate name from path when no operationId', async () => {
      const doc = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{userId}': {
            get: {
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const schema = await parseOpenAPIDocument(doc);
      // Should generate something like 'getUsersByUserId'
      expect(schema.services[0]?.methods[0]?.name).toMatch(/get.*users.*userId/i);
    });

    it('should sanitize operationId with special characters', async () => {
      const doc = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              operationId: 'get-all-items.v2',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const schema = await parseOpenAPIDocument(doc);
      const methodName = schema.services[0]?.methods[0]?.name;
      // Should not contain special characters
      expect(methodName).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
    });
  });

  describe('error handling', () => {
    it('should throw ParserError for non-existent file', async () => {
      await expect(parseOpenAPIFile('/non/existent/file.yaml')).rejects.toThrow(ParserError);
    });

    it('should throw ParserError for invalid schema', async () => {
      await expect(parseOpenAPIFile(INVALID_PATH)).rejects.toThrow(ParserError);
    });

    it('should include file path in error for file parsing', async () => {
      try {
        await parseOpenAPIFile('/non/existent/file.yaml');
      } catch (error) {
        expect(error).toBeInstanceOf(ParserError);
        if (error instanceof ParserError) {
          expect(error.location?.file).toBe('/non/existent/file.yaml');
        }
      }
    });
  });

  describe('static methods', () => {
    it('should work with static parseFile', async () => {
      const schema = await OpenAPIParser.parseFile(PETSTORE_PATH);
      expect(schema.sourceType).toBe('openapi');
    });

    it('should work with static parseDocument', async () => {
      const doc = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
      };

      const schema = await OpenAPIParser.parseDocument(doc);
      expect(schema.sourceType).toBe('openapi');
    });
  });
});
