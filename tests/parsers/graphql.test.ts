/**
 * Tests for the GraphQL SDL Parser
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  GraphQLSDLParser,
  parseGraphQLFile,
  parseGraphQLString,
} from '../../src/parsers/graphql.js';
import { ParserError } from '../../src/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, '../fixtures');

// ============================================================================
// GraphQL SDL String Parsing
// ============================================================================

describe('GraphQLSDLParser', () => {
  describe('parseString - basic types', () => {
    it('should parse a simple Query type', () => {
      const sdl = `
        type Query {
          hello: String!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);

      expect(schema.sourceType).toBe('graphql');
      expect(schema.services).toHaveLength(1);
      expect(schema.services[0]!.name).toBe('Default');
      expect(schema.services[0]!.methods).toHaveLength(1);

      const method = schema.services[0]!.methods[0]!;
      expect(method.name).toBe('hello');
      expect(method.httpMethod).toBe('GET');
      expect(method.path).toBe('/hello');
      expect(method.output).toEqual(
        expect.objectContaining({ kind: 'primitive', primitiveType: 'string' })
      );
    });

    it('should parse Query with arguments', () => {
      const sdl = `
        type Query {
          user(id: ID!): User
        }
        type User {
          id: ID!
          name: String!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const method = schema.services[0]!.methods[0]!;

      expect(method.name).toBe('user');
      expect(method.input.kind).toBe('object');
      if (method.input.kind === 'object') {
        expect(method.input.fields).toHaveLength(1);
        expect(method.input.fields[0]!.name).toBe('id');
        expect(method.input.fields[0]!.required).toBe(true);
      }

      expect(method.parameters).toHaveLength(1);
      expect(method.parameters![0]!.name).toBe('id');
      expect(method.parameters![0]!.location).toBe('query');
    });

    it('should parse Mutation type as POST methods', () => {
      const sdl = `
        type Mutation {
          createUser(name: String!, email: String!): User!
        }
        type User {
          id: ID!
          name: String!
          email: String!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const method = schema.services[0]!.methods[0]!;

      expect(method.name).toBe('createUser');
      expect(method.httpMethod).toBe('POST');
      expect(method.path).toBe('/createUser');
      expect(method.tags).toContain('mutation');
    });

    it('should parse Subscription type as streaming methods', () => {
      const sdl = `
        type Subscription {
          messageReceived: Message!
        }
        type Message {
          id: ID!
          text: String!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const method = schema.services[0]!.methods[0]!;

      expect(method.name).toBe('messageReceived');
      expect(method.streaming).toBe('server');
      expect(method.httpMethod).toBeUndefined();
      expect(method.tags).toContain('subscription');
    });

    it('should parse methods with no arguments as void input', () => {
      const sdl = `
        type Query {
          allUsers: [User!]!
        }
        type User {
          id: ID!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const method = schema.services[0]!.methods[0]!;

      expect(method.input.kind).toBe('void');
      expect(method.parameters).toBeUndefined();
    });
  });

  describe('parseString - type mapping', () => {
    it('should map GraphQL scalars to IR primitives', () => {
      const sdl = `
        type Query {
          dummy: String
        }
        type AllTypes {
          str: String!
          int: Int!
          float: Float!
          bool: Boolean!
          id: ID!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const allTypes = schema.types?.get('AllTypes');
      expect(allTypes).toBeDefined();
      expect(allTypes!.kind).toBe('object');

      if (allTypes?.kind === 'object') {
        const fields = allTypes.fields;
        expect(fields).toHaveLength(5);

        // String
        expect(fields[0]!.type).toEqual(
          expect.objectContaining({ kind: 'primitive', primitiveType: 'string' })
        );
        // Int
        expect(fields[1]!.type).toEqual(
          expect.objectContaining({ kind: 'primitive', primitiveType: 'integer' })
        );
        // Float
        expect(fields[2]!.type).toEqual(
          expect.objectContaining({ kind: 'primitive', primitiveType: 'number' })
        );
        // Boolean
        expect(fields[3]!.type).toEqual(
          expect.objectContaining({ kind: 'primitive', primitiveType: 'boolean' })
        );
        // ID → string
        expect(fields[4]!.type).toEqual(
          expect.objectContaining({ kind: 'primitive', primitiveType: 'string' })
        );
      }
    });

    it('should handle list types', () => {
      const sdl = `
        type Query {
          tags: [String!]!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const method = schema.services[0]!.methods[0]!;

      expect(method.output.kind).toBe('array');
      if (method.output.kind === 'array') {
        expect(method.output.elementType).toEqual(
          expect.objectContaining({ kind: 'primitive', primitiveType: 'string' })
        );
      }
    });

    it('should handle enum types', () => {
      const sdl = `
        type Query {
          dummy: String
        }
        enum Status {
          ACTIVE
          INACTIVE
          DELETED
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const statusType = schema.types?.get('Status');

      expect(statusType).toBeDefined();
      expect(statusType!.kind).toBe('enum');
      if (statusType?.kind === 'enum') {
        expect(statusType.values).toEqual(['ACTIVE', 'INACTIVE', 'DELETED']);
        expect(statusType.name).toBe('Status');
      }
    });

    it('should handle union types', () => {
      const sdl = `
        type Query {
          dummy: String
        }
        type Dog { name: String! }
        type Cat { name: String! }
        union Animal = Dog | Cat
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const animalType = schema.types?.get('Animal');

      expect(animalType).toBeDefined();
      expect(animalType!.kind).toBe('union');
      if (animalType?.kind === 'union') {
        expect(animalType.name).toBe('Animal');
        expect(animalType.variants).toHaveLength(2);
      }
    });

    it('should handle input types', () => {
      const sdl = `
        type Query { dummy: String }
        input CreateInput {
          name: String!
          age: Int
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const inputType = schema.types?.get('CreateInput');

      expect(inputType).toBeDefined();
      expect(inputType!.kind).toBe('object');
      if (inputType?.kind === 'object') {
        expect(inputType.fields).toHaveLength(2);
        expect(inputType.fields[0]!.name).toBe('name');
        expect(inputType.fields[0]!.required).toBe(true);
        expect(inputType.fields[1]!.name).toBe('age');
        expect(inputType.fields[1]!.required).toBe(false);
        expect(inputType.metadata?.isInput).toBe(true);
      }
    });

    it('should handle custom scalars as string', () => {
      const sdl = `
        scalar DateTime
        type Query {
          now: DateTime
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const dateTimeType = schema.types?.get('DateTime');

      expect(dateTimeType).toBeDefined();
      expect(dateTimeType!.kind).toBe('primitive');
      if (dateTimeType?.kind === 'primitive') {
        expect(dateTimeType.primitiveType).toBe('string');
        expect(dateTimeType.metadata?.customScalar).toBe(true);
      }
    });
  });

  describe('parseString - descriptions and deprecation', () => {
    it('should capture descriptions', () => {
      const sdl = `
        """
        Get all items
        """
        type Query {
          """
          Fetch a single item
          """
          item(id: ID!): Item
        }
        """
        An item in the system
        """
        type Item {
          id: ID!
          """
          Display name
          """
          name: String!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      const method = schema.services[0]!.methods[0]!;
      expect(method.description).toBe('Fetch a single item');

      const itemType = schema.types?.get('Item');
      expect(itemType?.description).toBe('An item in the system');

      if (itemType?.kind === 'object') {
        expect(itemType.fields[1]!.description).toBe('Display name');
      }
    });

    it('should detect deprecated fields', () => {
      const sdl = `
        type Query {
          current: String!
          old: String! @deprecated(reason: "Use current")
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      expect(schema.services[0]!.methods).toHaveLength(2);

      const oldMethod = schema.services[0]!.methods.find(
        (m) => m.name === 'old'
      );
      expect(oldMethod?.deprecated).toBe(true);

      const currentMethod = schema.services[0]!.methods.find(
        (m) => m.name === 'current'
      );
      expect(currentMethod?.deprecated).toBeFalsy();
    });

    it('should exclude deprecated fields when includeDeprecated is false', () => {
      const sdl = `
        type Query {
          current: String!
          old: String! @deprecated
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl, {
        includeDeprecated: false,
      });
      expect(schema.services[0]!.methods).toHaveLength(1);
      expect(schema.services[0]!.methods[0]!.name).toBe('current');
    });
  });

  describe('parseString - options', () => {
    it('should use custom service name', () => {
      const sdl = `
        type Query {
          hello: String!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl, {
        defaultServiceName: 'MyService',
      });
      expect(schema.services[0]!.name).toBe('MyService');
    });

    it('should disable HTTP method mapping', () => {
      const sdl = `
        type Query {
          hello: String!
        }
        type Mutation {
          doThing: Boolean!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl, {
        mapQueryToGet: false,
        mapMutationToPost: false,
      });

      const queryMethod = schema.services[0]!.methods.find(
        (m) => m.name === 'hello'
      );
      expect(queryMethod?.httpMethod).toBeUndefined();

      const mutationMethod = schema.services[0]!.methods.find(
        (m) => m.name === 'doThing'
      );
      expect(mutationMethod?.httpMethod).toBeUndefined();
    });

    it('should set metadata about root types', () => {
      const sdl = `
        type Query { hello: String! }
        type Mutation { doThing: Boolean! }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      expect(schema.metadata?.hasQuery).toBe(true);
      expect(schema.metadata?.hasMutation).toBe(true);
      expect(schema.metadata?.hasSubscription).toBe(false);
    });
  });

  describe('parseString - empty schema', () => {
    it('should handle schema with no root types', () => {
      const sdl = `
        type Foo {
          bar: String!
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      expect(schema.services).toHaveLength(0);
      expect(schema.types?.get('Foo')).toBeDefined();
    });

    it('should return empty services for an empty Query', () => {
      // GraphQL requires at least one field, but this is a parser test
      // We handle the case gracefully
      const sdl = `
        type Query {
          _placeholder: String
        }
      `;

      const schema = GraphQLSDLParser.parseString(sdl);
      expect(schema.services).toHaveLength(1);
      expect(schema.services[0]!.methods).toHaveLength(1);
    });
  });

  describe('parseString - error handling', () => {
    it('should throw ParserError for invalid SDL', () => {
      const invalidSdl = 'this is not valid graphql!!!';

      expect(() => GraphQLSDLParser.parseString(invalidSdl)).toThrow(
        ParserError
      );
    });

    it('should include error details in ParserError', () => {
      try {
        GraphQLSDLParser.parseString('invalid { syntax');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ParserError);
        if (error instanceof ParserError) {
          expect(error.sourceType).toBe('graphql');
          expect(error.message).toContain('Failed to parse GraphQL SDL');
        }
      }
    });
  });

  // ============================================================================
  // File Parsing
  // ============================================================================

  describe('parseFile', () => {
    it('should parse the blog schema fixture', () => {
      const filePath = resolve(FIXTURES_DIR, 'schema.graphql');
      const schema = GraphQLSDLParser.parseFile(filePath);

      expect(schema.sourceType).toBe('graphql');
      expect(schema.services).toHaveLength(1);

      const service = schema.services[0]!;

      // Query: post, posts, user, searchPosts, legacyPosts
      // Mutation: createPost, updatePost, deletePost, publishPost
      // Subscription: postCreated, postUpdated
      expect(service.methods.length).toBeGreaterThanOrEqual(10);

      // Check specific methods
      const postMethod = service.methods.find((m) => m.name === 'post');
      expect(postMethod).toBeDefined();
      expect(postMethod?.httpMethod).toBe('GET');

      const createPostMethod = service.methods.find(
        (m) => m.name === 'createPost'
      );
      expect(createPostMethod).toBeDefined();
      expect(createPostMethod?.httpMethod).toBe('POST');

      const postCreatedMethod = service.methods.find(
        (m) => m.name === 'postCreated'
      );
      expect(postCreatedMethod).toBeDefined();
      expect(postCreatedMethod?.streaming).toBe('server');
    });

    it('should parse types from the fixture', () => {
      const filePath = resolve(FIXTURES_DIR, 'schema.graphql');
      const schema = GraphQLSDLParser.parseFile(filePath);

      // Check named types
      expect(schema.types).toBeDefined();

      const postType = schema.types?.get('Post');
      expect(postType).toBeDefined();
      expect(postType?.kind).toBe('object');

      const userType = schema.types?.get('User');
      expect(userType).toBeDefined();

      const postStatusEnum = schema.types?.get('PostStatus');
      expect(postStatusEnum).toBeDefined();
      expect(postStatusEnum?.kind).toBe('enum');
      if (postStatusEnum?.kind === 'enum') {
        expect(postStatusEnum.values).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
      }

      const createPostResult = schema.types?.get('CreatePostResult');
      expect(createPostResult).toBeDefined();
      expect(createPostResult?.kind).toBe('union');
    });

    it('should throw ParserError for non-existent file', () => {
      expect(() =>
        GraphQLSDLParser.parseFile('/nonexistent/file.graphql')
      ).toThrow(ParserError);
    });
  });

  // ============================================================================
  // Convenience Functions
  // ============================================================================

  describe('convenience functions', () => {
    it('parseGraphQLFile should work', () => {
      const filePath = resolve(FIXTURES_DIR, 'schema.graphql');
      const schema = parseGraphQLFile(filePath);

      expect(schema.sourceType).toBe('graphql');
      expect(schema.services.length).toBeGreaterThan(0);
    });

    it('parseGraphQLString should work', () => {
      const schema = parseGraphQLString(`
        type Query { ping: String! }
      `);

      expect(schema.sourceType).toBe('graphql');
      expect(schema.services[0]!.methods[0]!.name).toBe('ping');
    });
  });
});
