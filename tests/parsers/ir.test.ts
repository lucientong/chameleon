/**
 * Tests for IR type definitions, factory functions, and type guards
 */

import { describe, it, expect } from 'vitest';
import {
  // Type guards
  isIRType,
  isPrimitiveType,
  isObjectType,
  isArrayType,
  isEnumType,
  isUnionType,
  isRefType,
  isAnyType,
  isVoidType,
  // Factory functions
  createPrimitiveType,
  createObjectType,
  createArrayType,
  createEnumType,
  createUnionType,
  createRefType,
  createAnyType,
  createVoidType,
  createField,
  createParameter,
  createMethod,
  createService,
  createSchema,
  // Utility functions
  getTypeName,
  cloneType,
  typeEquals,
  visitTypes,
  collectRefs,
} from '../../src/parsers/ir.js';

describe('IR Factory Functions', () => {
  describe('createPrimitiveType', () => {
    it('should create a string primitive type', () => {
      const type = createPrimitiveType('string');
      expect(type.kind).toBe('primitive');
      expect(type.primitiveType).toBe('string');
    });

    it('should create a number primitive type with options', () => {
      const type = createPrimitiveType('number', {
        description: 'A numeric value',
        format: 'double',
        defaultValue: 0,
      });
      expect(type.kind).toBe('primitive');
      expect(type.primitiveType).toBe('number');
      expect(type.description).toBe('A numeric value');
      expect(type.format).toBe('double');
      expect(type.defaultValue).toBe(0);
    });

    it('should create all primitive types', () => {
      expect(createPrimitiveType('string').primitiveType).toBe('string');
      expect(createPrimitiveType('number').primitiveType).toBe('number');
      expect(createPrimitiveType('integer').primitiveType).toBe('integer');
      expect(createPrimitiveType('boolean').primitiveType).toBe('boolean');
    });
  });

  describe('createObjectType', () => {
    it('should create an empty object type', () => {
      const type = createObjectType([]);
      expect(type.kind).toBe('object');
      expect(type.fields).toEqual([]);
    });

    it('should create an object type with fields', () => {
      const fields = [
        createField('name', createPrimitiveType('string'), true),
        createField('age', createPrimitiveType('integer'), false),
      ];
      const type = createObjectType(fields, { name: 'Person' });

      expect(type.kind).toBe('object');
      expect(type.name).toBe('Person');
      expect(type.fields).toHaveLength(2);
      expect(type.fields[0]?.name).toBe('name');
      expect(type.fields[1]?.name).toBe('age');
    });
  });

  describe('createArrayType', () => {
    it('should create an array of primitives', () => {
      const type = createArrayType(createPrimitiveType('string'));
      expect(type.kind).toBe('array');
      expect(type.elementType.kind).toBe('primitive');
    });

    it('should create an array with constraints', () => {
      const type = createArrayType(createPrimitiveType('integer'), {
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
      });
      expect(type.minItems).toBe(1);
      expect(type.maxItems).toBe(10);
      expect(type.uniqueItems).toBe(true);
    });
  });

  describe('createEnumType', () => {
    it('should create a string enum', () => {
      const type = createEnumType(['red', 'green', 'blue'], { name: 'Color' });
      expect(type.kind).toBe('enum');
      expect(type.name).toBe('Color');
      expect(type.values).toEqual(['red', 'green', 'blue']);
    });

    it('should create a numeric enum', () => {
      const type = createEnumType([0, 1, 2]);
      expect(type.values).toEqual([0, 1, 2]);
    });
  });

  describe('createUnionType', () => {
    it('should create a union type', () => {
      const variants = [
        createPrimitiveType('string'),
        createPrimitiveType('number'),
      ];
      const type = createUnionType(variants);
      expect(type.kind).toBe('union');
      expect(type.variants).toHaveLength(2);
    });

    it('should create a discriminated union', () => {
      const type = createUnionType(
        [createObjectType([]), createObjectType([])],
        { discriminator: 'type' }
      );
      expect(type.discriminator).toBe('type');
    });
  });

  describe('createRefType', () => {
    it('should create a reference type', () => {
      const type = createRefType('User');
      expect(type.kind).toBe('ref');
      expect(type.refName).toBe('User');
    });
  });

  describe('createAnyType', () => {
    it('should create an any type', () => {
      const type = createAnyType();
      expect(type.kind).toBe('any');
    });

    it('should create an any type with description', () => {
      const type = createAnyType({ description: 'Dynamic data' });
      expect(type.description).toBe('Dynamic data');
    });
  });

  describe('createVoidType', () => {
    it('should create a void type', () => {
      const type = createVoidType();
      expect(type.kind).toBe('void');
    });
  });

  describe('createField', () => {
    it('should create a required field', () => {
      const field = createField('id', createPrimitiveType('integer'), true);
      expect(field.name).toBe('id');
      expect(field.required).toBe(true);
      expect(field.type.kind).toBe('primitive');
    });

    it('should create an optional field with description', () => {
      const field = createField('email', createPrimitiveType('string'), false, {
        description: 'User email address',
        deprecated: true,
      });
      expect(field.required).toBe(false);
      expect(field.description).toBe('User email address');
      expect(field.deprecated).toBe(true);
    });
  });

  describe('createParameter', () => {
    it('should create a path parameter', () => {
      const param = createParameter('id', createPrimitiveType('integer'), 'path', true);
      expect(param.name).toBe('id');
      expect(param.location).toBe('path');
      expect(param.required).toBe(true);
    });

    it('should create a query parameter with default', () => {
      const param = createParameter('limit', createPrimitiveType('integer'), 'query', false, {
        defaultValue: 20,
        description: 'Page size',
      });
      expect(param.location).toBe('query');
      expect(param.defaultValue).toBe(20);
    });
  });

  describe('createMethod', () => {
    it('should create a method', () => {
      const method = createMethod(
        'listUsers',
        createVoidType(),
        createArrayType(createObjectType([]))
      );
      expect(method.name).toBe('listUsers');
      expect(method.input.kind).toBe('void');
      expect(method.output.kind).toBe('array');
    });

    it('should create an HTTP method', () => {
      const method = createMethod(
        'getUser',
        createObjectType([]),
        createObjectType([]),
        {
          httpMethod: 'GET',
          path: '/users/{id}',
          tags: ['users'],
        }
      );
      expect(method.httpMethod).toBe('GET');
      expect(method.path).toBe('/users/{id}');
      expect(method.tags).toContain('users');
    });
  });

  describe('createService', () => {
    it('should create a service with methods', () => {
      const methods = [
        createMethod('list', createVoidType(), createArrayType(createAnyType())),
        createMethod('get', createObjectType([]), createObjectType([])),
      ];
      const service = createService('UserService', methods);

      expect(service.name).toBe('UserService');
      expect(service.methods).toHaveLength(2);
    });
  });

  describe('createSchema', () => {
    it('should create a schema', () => {
      const service = createService('API', []);
      const schema = createSchema([service], 'openapi', {
        title: 'My API',
        version: '1.0.0',
      });

      expect(schema.services).toHaveLength(1);
      expect(schema.sourceType).toBe('openapi');
      expect(schema.title).toBe('My API');
      expect(schema.version).toBe('1.0.0');
    });
  });
});

describe('IR Type Guards', () => {
  const primitiveType = createPrimitiveType('string');
  const objectType = createObjectType([]);
  const arrayType = createArrayType(primitiveType);
  const enumType = createEnumType(['a', 'b']);
  const unionType = createUnionType([primitiveType, objectType]);
  const refType = createRefType('User');
  const anyType = createAnyType();
  const voidType = createVoidType();

  describe('isIRType', () => {
    it('should return true for all IR types', () => {
      expect(isIRType(primitiveType)).toBe(true);
      expect(isIRType(objectType)).toBe(true);
      expect(isIRType(arrayType)).toBe(true);
      expect(isIRType(enumType)).toBe(true);
      expect(isIRType(unionType)).toBe(true);
      expect(isIRType(refType)).toBe(true);
      expect(isIRType(anyType)).toBe(true);
      expect(isIRType(voidType)).toBe(true);
    });

    it('should return false for non-IR types', () => {
      expect(isIRType(null)).toBe(false);
      expect(isIRType(undefined)).toBe(false);
      expect(isIRType('string')).toBe(false);
      expect(isIRType(123)).toBe(false);
      expect(isIRType({ kind: 'invalid' })).toBe(false);
    });
  });

  describe('isPrimitiveType', () => {
    it('should correctly identify primitive types', () => {
      expect(isPrimitiveType(primitiveType)).toBe(true);
      expect(isPrimitiveType(objectType)).toBe(false);
      expect(isPrimitiveType(arrayType)).toBe(false);
    });
  });

  describe('isObjectType', () => {
    it('should correctly identify object types', () => {
      expect(isObjectType(objectType)).toBe(true);
      expect(isObjectType(primitiveType)).toBe(false);
    });
  });

  describe('isArrayType', () => {
    it('should correctly identify array types', () => {
      expect(isArrayType(arrayType)).toBe(true);
      expect(isArrayType(objectType)).toBe(false);
    });
  });

  describe('isEnumType', () => {
    it('should correctly identify enum types', () => {
      expect(isEnumType(enumType)).toBe(true);
      expect(isEnumType(primitiveType)).toBe(false);
    });
  });

  describe('isUnionType', () => {
    it('should correctly identify union types', () => {
      expect(isUnionType(unionType)).toBe(true);
      expect(isUnionType(objectType)).toBe(false);
    });
  });

  describe('isRefType', () => {
    it('should correctly identify ref types', () => {
      expect(isRefType(refType)).toBe(true);
      expect(isRefType(objectType)).toBe(false);
    });
  });

  describe('isAnyType', () => {
    it('should correctly identify any types', () => {
      expect(isAnyType(anyType)).toBe(true);
      expect(isAnyType(voidType)).toBe(false);
    });
  });

  describe('isVoidType', () => {
    it('should correctly identify void types', () => {
      expect(isVoidType(voidType)).toBe(true);
      expect(isVoidType(anyType)).toBe(false);
    });
  });
});

describe('IR Utility Functions', () => {
  describe('getTypeName', () => {
    it('should return correct names for all types', () => {
      expect(getTypeName(createPrimitiveType('string'))).toBe('string');
      expect(getTypeName(createPrimitiveType('number'))).toBe('number');
      expect(getTypeName(createObjectType([], { name: 'User' }))).toBe('User');
      expect(getTypeName(createObjectType([]))).toBe('Object');
      expect(getTypeName(createArrayType(createPrimitiveType('string')))).toBe('Array<string>');
      expect(getTypeName(createEnumType(['a', 'b'], { name: 'Status' }))).toBe('Status');
      expect(getTypeName(createEnumType(['a', 'b']))).toBe('Enum');
      expect(getTypeName(createRefType('User'))).toBe('User');
      expect(getTypeName(createAnyType())).toBe('any');
      expect(getTypeName(createVoidType())).toBe('void');
    });

    it('should handle union type names', () => {
      const union = createUnionType([
        createPrimitiveType('string'),
        createPrimitiveType('number'),
      ]);
      expect(getTypeName(union)).toBe('string | number');

      const namedUnion = createUnionType(
        [createPrimitiveType('string'), createPrimitiveType('number')],
        { name: 'StringOrNumber' }
      );
      expect(getTypeName(namedUnion)).toBe('StringOrNumber');
    });
  });

  describe('cloneType', () => {
    it('should create a deep clone', () => {
      const original = createObjectType([
        createField('name', createPrimitiveType('string'), true),
      ]);
      const clone = cloneType(original);

      expect(clone).toEqual(original);
      expect(clone).not.toBe(original);
      
      // Modify clone and verify original is unchanged
      if (clone.kind === 'object') {
        clone.fields[0]!.name = 'modified';
      }
      expect(original.fields[0]?.name).toBe('name');
    });
  });

  describe('typeEquals', () => {
    it('should return true for equal types', () => {
      const type1 = createPrimitiveType('string');
      const type2 = createPrimitiveType('string');
      expect(typeEquals(type1, type2)).toBe(true);
    });

    it('should return false for different types', () => {
      const type1 = createPrimitiveType('string');
      const type2 = createPrimitiveType('number');
      expect(typeEquals(type1, type2)).toBe(false);
    });

    it('should compare nested structures', () => {
      const type1 = createArrayType(createPrimitiveType('string'));
      const type2 = createArrayType(createPrimitiveType('string'));
      const type3 = createArrayType(createPrimitiveType('number'));

      expect(typeEquals(type1, type2)).toBe(true);
      expect(typeEquals(type1, type3)).toBe(false);
    });
  });

  describe('visitTypes', () => {
    it('should visit all types in a tree', () => {
      const visited: string[] = [];
      const type = createObjectType([
        createField('items', createArrayType(createPrimitiveType('string')), true),
      ]);

      visitTypes(type, (t) => visited.push(t.kind));

      expect(visited).toEqual(['object', 'array', 'primitive']);
    });

    it('should visit union variants', () => {
      const visited: string[] = [];
      const type = createUnionType([
        createPrimitiveType('string'),
        createPrimitiveType('number'),
      ]);

      visitTypes(type, (t) => visited.push(t.kind));

      expect(visited).toEqual(['union', 'primitive', 'primitive']);
    });
  });

  describe('collectRefs', () => {
    it('should collect all ref type names', () => {
      const type = createObjectType([
        createField('user', createRefType('User'), true),
        createField('posts', createArrayType(createRefType('Post')), false),
      ]);

      const refs = collectRefs(type);

      expect(refs.has('User')).toBe(true);
      expect(refs.has('Post')).toBe(true);
      expect(refs.size).toBe(2);
    });

    it('should return empty set when no refs', () => {
      const type = createPrimitiveType('string');
      const refs = collectRefs(type);
      expect(refs.size).toBe(0);
    });
  });
});
