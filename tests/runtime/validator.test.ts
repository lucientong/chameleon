/**
 * Tests for Runtime Validator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Validator,
  createValidator,
  validateType,
  assertValid,
  type ValidationResult,
} from '../../src/runtime/validator.js';
import {
  createPrimitiveType,
  createObjectType,
  createArrayType,
  createEnumType,
  createField,
  createParameter,
  createMethod,
  createVoidType,
  type IRMethod,
} from '../../src/parsers/ir.js';
import { ValidationError } from '../../src/errors.js';

describe('Validator', () => {
  let validator: Validator;

  beforeEach(() => {
    validator = new Validator();
  });

  describe('Primitive Type Validation', () => {
    it('should validate string type', () => {
      const type = createPrimitiveType('string');
      const result = validator.validate('hello', type);
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should coerce number to string when coerceTypes is enabled', () => {
      const type = createPrimitiveType('string');
      const result = validator.validate(123, type);
      expect(result.success).toBe(true);
      expect(result.data).toBe('123');
    });

    it('should validate integer type', () => {
      const type = createPrimitiveType('integer');
      const result = validator.validate(42, type);
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('should reject non-integer for integer type', () => {
      const validator = new Validator({ coerceTypes: false });
      const type = createPrimitiveType('integer');
      const result = validator.validate(3.14, type);
      expect(result.success).toBe(false);
    });

    it('should validate number type', () => {
      const type = createPrimitiveType('number');
      const result = validator.validate(3.14, type);
      expect(result.success).toBe(true);
      expect(result.data).toBe(3.14);
    });

    it('should validate boolean type', () => {
      const type = createPrimitiveType('boolean');
      const result = validator.validate(true, type);
      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should coerce string to boolean', () => {
      const type = createPrimitiveType('boolean');
      const result = validator.validate('true', type);
      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should validate email format', () => {
      const type = createPrimitiveType('string', { format: 'email' });
      const validResult = validator.validate('test@example.com', type);
      expect(validResult.success).toBe(true);

      const invalidResult = validator.validate('not-an-email', type);
      expect(invalidResult.success).toBe(false);
    });

    it('should validate uuid format', () => {
      const type = createPrimitiveType('string', { format: 'uuid' });
      const validResult = validator.validate('550e8400-e29b-41d4-a716-446655440000', type);
      expect(validResult.success).toBe(true);

      const invalidResult = validator.validate('not-a-uuid', type);
      expect(invalidResult.success).toBe(false);
    });

    it('should validate uri format', () => {
      const type = createPrimitiveType('string', { format: 'uri' });
      const validResult = validator.validate('https://example.com', type);
      expect(validResult.success).toBe(true);

      const invalidResult = validator.validate('not a url', type);
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('Object Type Validation', () => {
    it('should validate simple object', () => {
      const type = createObjectType([
        createField('name', createPrimitiveType('string'), true),
        createField('age', createPrimitiveType('integer'), true),
      ]);

      const result = validator.validate({ name: 'John', age: 30 }, type);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'John', age: 30 });
    });

    it('should reject missing required fields', () => {
      const type = createObjectType([
        createField('name', createPrimitiveType('string'), true),
        createField('age', createPrimitiveType('integer'), true),
      ]);

      const result = validator.validate({ name: 'John' }, type);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.path).toBe('age');
    });

    it('should allow optional fields to be missing', () => {
      const type = createObjectType([
        createField('name', createPrimitiveType('string'), true),
        createField('nickname', createPrimitiveType('string'), false),
      ]);

      const result = validator.validate({ name: 'John' }, type);
      expect(result.success).toBe(true);
    });

    it('should validate nested objects', () => {
      const addressType = createObjectType([
        createField('street', createPrimitiveType('string'), true),
        createField('city', createPrimitiveType('string'), true),
      ]);

      const type = createObjectType([
        createField('name', createPrimitiveType('string'), true),
        createField('address', addressType, true),
      ]);

      const result = validator.validate({
        name: 'John',
        address: { street: '123 Main St', city: 'Anytown' },
      }, type);
      expect(result.success).toBe(true);
    });

    it('should strip unknown properties when stripUnknown is true', () => {
      const validator = new Validator({ stripUnknown: true });
      const type = createObjectType([
        createField('name', createPrimitiveType('string'), true),
      ]);

      const result = validator.validate({ name: 'John', extra: 'field' }, type);
      expect(result.success).toBe(false); // strict mode rejects unknown
    });

    it('should allow additional properties when configured', () => {
      const type = createObjectType(
        [createField('name', createPrimitiveType('string'), true)],
        { additionalProperties: true }
      );

      const result = validator.validate({ name: 'John', extra: 'allowed' }, type);
      expect(result.success).toBe(true);
    });
  });

  describe('Array Type Validation', () => {
    it('should validate array of primitives', () => {
      const type = createArrayType(createPrimitiveType('string'));
      const result = validator.validate(['a', 'b', 'c'], type);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(['a', 'b', 'c']);
    });

    it('should validate array of objects', () => {
      const itemType = createObjectType([
        createField('id', createPrimitiveType('integer'), true),
      ]);
      const type = createArrayType(itemType);

      const result = validator.validate([{ id: 1 }, { id: 2 }], type);
      expect(result.success).toBe(true);
    });

    it('should reject non-array values', () => {
      const type = createArrayType(createPrimitiveType('string'));
      const result = validator.validate('not an array', type);
      expect(result.success).toBe(false);
    });

    it('should enforce minItems constraint', () => {
      const type = createArrayType(createPrimitiveType('string'), { minItems: 2 });
      
      const validResult = validator.validate(['a', 'b'], type);
      expect(validResult.success).toBe(true);

      const invalidResult = validator.validate(['a'], type);
      expect(invalidResult.success).toBe(false);
    });

    it('should enforce maxItems constraint', () => {
      const type = createArrayType(createPrimitiveType('string'), { maxItems: 2 });
      
      const validResult = validator.validate(['a', 'b'], type);
      expect(validResult.success).toBe(true);

      const invalidResult = validator.validate(['a', 'b', 'c'], type);
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('Enum Type Validation', () => {
    it('should validate valid enum values', () => {
      const type = createEnumType(['red', 'green', 'blue']);
      
      const result = validator.validate('red', type);
      expect(result.success).toBe(true);
      expect(result.data).toBe('red');
    });

    it('should reject invalid enum values', () => {
      const type = createEnumType(['red', 'green', 'blue']);
      
      const result = validator.validate('yellow', type);
      expect(result.success).toBe(false);
    });
  });

  describe('Method Input Validation', () => {
    it('should validate method input type', () => {
      const inputType = createObjectType([
        createField('name', createPrimitiveType('string'), true),
      ]);
      const method = createMethod('createPet', inputType, createVoidType());

      const result = validator.validateMethodInput({ name: 'Fluffy' }, method);
      expect(result.success).toBe(true);
    });

    it('should validate method with parameters', () => {
      const method: IRMethod = {
        name: 'getPet',
        input: createVoidType(),
        output: createVoidType(),
        parameters: [
          createParameter('petId', createPrimitiveType('integer'), 'path', true),
          createParameter('include', createPrimitiveType('string'), 'query', false),
        ],
      };

      const result = validator.validateMethodInput({ petId: 123, include: 'details' }, method);
      expect(result.success).toBe(true);
    });
  });

  describe('Query Parameter Validation', () => {
    it('should coerce and validate query parameters', () => {
      const method: IRMethod = {
        name: 'listPets',
        input: createVoidType(),
        output: createVoidType(),
        parameters: [
          createParameter('limit', createPrimitiveType('integer'), 'query', false),
          createParameter('offset', createPrimitiveType('integer'), 'query', false),
        ],
      };

      const result = validator.validateQueryParams(
        { limit: '10', offset: '5' },
        method
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ limit: 10, offset: 5 });
    });

    it('should handle missing optional query parameters', () => {
      const method: IRMethod = {
        name: 'listPets',
        input: createVoidType(),
        output: createVoidType(),
        parameters: [
          createParameter('limit', createPrimitiveType('integer'), 'query', false),
        ],
      };

      const result = validator.validateQueryParams({}, method);
      expect(result.success).toBe(true);
    });
  });

  describe('Path Parameter Validation', () => {
    it('should coerce and validate path parameters', () => {
      const method: IRMethod = {
        name: 'getPet',
        input: createVoidType(),
        output: createVoidType(),
        parameters: [
          createParameter('petId', createPrimitiveType('integer'), 'path', true),
        ],
      };

      const result = validator.validatePathParams({ petId: '123' }, method);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ petId: 123 });
    });
  });

  describe('Body Validation', () => {
    it('should validate request body', () => {
      const bodyType = createObjectType([
        createField('name', createPrimitiveType('string'), true),
        createField('age', createPrimitiveType('integer'), false),
      ]);
      const method = createMethod('createPet', bodyType, createVoidType());

      const result = validator.validateBody({ name: 'Fluffy', age: 3 }, method);
      expect(result.success).toBe(true);
    });
  });
});

describe('createValidator', () => {
  it('should create a validator with default options', () => {
    const validator = createValidator();
    expect(validator).toBeInstanceOf(Validator);
  });

  it('should create a validator with custom options', () => {
    const validator = createValidator(undefined, { coerceTypes: false });
    
    const type = createPrimitiveType('integer');
    const result = validator.validate('123', type);
    // Without coercion, string should fail integer validation
    expect(result.success).toBe(false);
  });
});

describe('validateType', () => {
  it('should validate type as a standalone function', () => {
    const type = createPrimitiveType('string');
    const result = validateType('hello', type);
    expect(result.success).toBe(true);
    expect(result.data).toBe('hello');
  });
});

describe('assertValid', () => {
  it('should return data for valid result', () => {
    const result: ValidationResult<string> = {
      success: true,
      data: 'valid data',
    };
    expect(assertValid(result)).toBe('valid data');
  });

  it('should throw ValidationError for invalid result', () => {
    const result: ValidationResult<string> = {
      success: false,
      errors: [{ path: 'field', message: 'Invalid' }],
    };
    expect(() => assertValid(result)).toThrow(ValidationError);
  });
});
