/**
 * Tests for gRPC Generator
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GrpcGenerator,
  generateGrpc,
  generateProtoFile,
} from '../../src/generators/grpc-generator.js';
import { parseProtobufFile } from '../../src/parsers/protobuf.js';
import {
  createSchema,
  createService,
  createMethod,
  createObjectType,
  createField,
  createPrimitiveType,
  createArrayType,
  createEnumType,
  createVoidType,
  createAnyType,
} from '../../src/parsers/ir.js';
import type { IRSchema } from '../../src/parsers/ir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const GREETER_PROTO = path.join(FIXTURES_DIR, 'greeter.proto');

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a simple test IR schema for generator tests
 */
function createTestSchema(): IRSchema {
  const petType = createObjectType(
    [
      createField('id', createPrimitiveType('integer'), true, { description: 'Pet ID' }),
      createField('name', createPrimitiveType('string'), true, { description: 'Pet name' }),
      createField('status', createEnumType(['available', 'pending', 'sold'], { name: 'PetStatus' }), false),
      createField('tags', createArrayType(createPrimitiveType('string')), false),
    ],
    { name: 'Pet', description: 'A pet in the store' }
  );

  const createPetInput = createObjectType(
    [
      createField('name', createPrimitiveType('string'), true),
      createField('status', createEnumType(['available', 'pending', 'sold'], { name: 'PetStatus' }), false),
    ],
    { name: 'CreatePetRequest' }
  );

  const petIdInput = createObjectType(
    [createField('id', createPrimitiveType('integer'), true)],
    { name: 'GetPetRequest' }
  );

  const deletePetOutput = createObjectType(
    [createField('success', createPrimitiveType('boolean'), true)],
    { name: 'DeletePetResponse' }
  );

  const listPetsOutput = createObjectType(
    [
      createField('pets', createArrayType(petType), true),
      createField('total', createPrimitiveType('integer'), false),
    ],
    { name: 'ListPetsResponse' }
  );

  const listPetsInput = createObjectType(
    [
      createField('page_size', createPrimitiveType('integer'), false),
      createField('page_token', createPrimitiveType('string'), false),
    ],
    { name: 'ListPetsRequest' }
  );

  const petService = createService('PetService', [
    createMethod('GetPet', petIdInput, petType, {
      httpMethod: 'GET',
      path: '/pets/:id',
      description: 'Get a pet by ID',
    }),
    createMethod('ListPets', listPetsInput, listPetsOutput, {
      httpMethod: 'GET',
      path: '/pets',
      description: 'List all pets',
    }),
    createMethod('CreatePet', createPetInput, petType, {
      httpMethod: 'POST',
      path: '/pets',
      description: 'Create a new pet',
    }),
    createMethod('DeletePet', petIdInput, deletePetOutput, {
      httpMethod: 'DELETE',
      path: '/pets/:id',
      description: 'Delete a pet',
    }),
  ]);

  return createSchema([petService], 'openapi', {
    sourceVersion: '3.0.0',
    title: 'Petstore',
  });
}

/**
 * Create a schema with streaming methods
 */
function createStreamingSchema(): IRSchema {
  const requestType = createObjectType(
    [createField('message', createPrimitiveType('string'), true)],
    { name: 'StreamRequest' }
  );

  const responseType = createObjectType(
    [createField('message', createPrimitiveType('string'), true)],
    { name: 'StreamResponse' }
  );

  const service = createService('StreamService', [
    createMethod('Unary', requestType, responseType, {
      description: 'Unary RPC',
    }),
    createMethod('ServerStream', requestType, responseType, {
      streaming: 'server',
      description: 'Server streaming RPC',
    }),
    createMethod('ClientStream', requestType, responseType, {
      streaming: 'client',
      description: 'Client streaming RPC',
    }),
    createMethod('BidiStream', requestType, responseType, {
      streaming: 'bidi',
      description: 'Bidirectional streaming RPC',
    }),
  ]);

  return createSchema([service], 'protobuf', { sourceVersion: '3' });
}

// ============================================================================
// Tests
// ============================================================================

describe('GrpcGenerator', () => {
  describe('Proto File Generation', () => {
    it('should generate valid proto syntax header', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('syntax = "proto3"');
      expect(output.protoFile).toContain('package api;');
    });

    it('should support custom package name', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema, { packageName: 'petstore.v1' });

      expect(output.protoFile).toContain('package petstore.v1;');
    });

    it('should generate service definition', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('service PetService {');
      expect(output.protoFile).toContain('rpc GetPet');
      expect(output.protoFile).toContain('rpc ListPets');
      expect(output.protoFile).toContain('rpc CreatePet');
      expect(output.protoFile).toContain('rpc DeletePet');
    });

    it('should generate message definitions', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      // Should contain message types
      expect(output.protoFile).toContain('message');
      // Should contain field definitions with numbers
      expect(output.protoFile).toMatch(/= \d+;/);
    });

    it('should generate streaming annotations in proto', () => {
      const schema = createStreamingSchema();
      const output = generateGrpc(schema);

      // Unary: no stream keyword
      expect(output.protoFile).toContain(
        'rpc Unary (StreamRequest) returns (StreamResponse);'
      );

      // Server streaming
      expect(output.protoFile).toContain(
        'rpc ServerStream (StreamRequest) returns (stream StreamResponse);'
      );

      // Client streaming
      expect(output.protoFile).toContain(
        'rpc ClientStream (stream StreamRequest) returns (StreamResponse);'
      );

      // Bidirectional streaming
      expect(output.protoFile).toContain(
        'rpc BidiStream (stream StreamRequest) returns (stream StreamResponse);'
      );
    });

    it('should generate enum definitions', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('enum PetStatus {');
      expect(output.protoFile).toContain('AVAILABLE');
      expect(output.protoFile).toContain('PENDING');
      expect(output.protoFile).toContain('SOLD');
    });

    it('should generate repeated fields for arrays', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('repeated');
    });

    it('should handle void types as Empty message', () => {
      const service = createService('VoidService', [
        createMethod('Ping', createVoidType(), createVoidType()),
      ]);
      const schema = createSchema([service], 'protobuf');
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('message Empty {}');
      expect(output.protoFile).toContain('rpc Ping (Empty) returns (Empty);');
    });

    it('should include description comments', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      // Method descriptions as comments
      expect(output.protoFile).toContain('// Get a pet by ID');
    });
  });

  describe('Handler Code Generation', () => {
    it('should generate handler functions', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.handlerCode).toContain('export function');
      expect(output.handlerCode).toContain('getPet');
      expect(output.handlerCode).toContain('listPets');
      expect(output.handlerCode).toContain('createPet');
      expect(output.handlerCode).toContain('deletePet');
    });

    it('should generate unary handler signature', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      // Unary handlers should have call and callback parameters
      expect(output.handlerCode).toContain('grpc.ServerUnaryCall');
      expect(output.handlerCode).toContain('grpc.sendUnaryData');
    });

    it('should generate streaming handler signatures', () => {
      const schema = createStreamingSchema();
      const output = generateGrpc(schema);

      // Server streaming
      expect(output.handlerCode).toContain('grpc.ServerWritableStream');

      // Client streaming
      expect(output.handlerCode).toContain('grpc.ServerReadableStream');

      // Bidi streaming
      expect(output.handlerCode).toContain('grpc.ServerDuplexStream');
    });

    it('should generate grpc-js import', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.handlerCode).toContain("import type * as grpc from '@grpc/grpc-js'");
    });

    it('should generate @generated annotation', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.handlerCode).toContain('@generated');
    });

    it('should skip handler generation when disabled', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema, { generateHandlers: false });

      expect(output.handlerCode).toBe('');
    });

    it('should include description comments in handlers', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.handlerCode).toContain('Get a pet by ID');
      expect(output.handlerCode).toContain('Create a new pet');
    });
  });

  describe('Type Definitions Generation', () => {
    it('should generate TypeScript interfaces', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.typeDefinitions).toContain('export interface');
    });

    it('should generate enum types in TypeScript', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.typeDefinitions).toContain('export enum PetStatus');
    });

    it('should generate field types correctly', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      // Primitive types
      expect(output.typeDefinitions).toContain('string');
      expect(output.typeDefinitions).toContain('number');
      expect(output.typeDefinitions).toContain('boolean');
    });

    it('should generate @generated annotation', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.typeDefinitions).toContain('@generated');
    });

    it('should skip type generation when disabled', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema, { generateTypes: false });

      expect(output.typeDefinitions).toBe('');
    });

    it('should handle Empty type for void', () => {
      const service = createService('VoidService', [
        createMethod('Ping', createVoidType(), createVoidType()),
      ]);
      const schema = createSchema([service], 'protobuf');
      const output = generateGrpc(schema);

      expect(output.typeDefinitions).toContain('export interface Empty');
    });
  });

  describe('Server Code Generation', () => {
    it('should generate server bootstrap code', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.serverCode).toContain("import * as grpc from '@grpc/grpc-js'");
      expect(output.serverCode).toContain("import * as protoLoader from '@grpc/proto-loader'");
    });

    it('should use configured port', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema, { serverPort: 9090 });

      expect(output.serverCode).toContain('9090');
    });

    it('should generate server.addService calls', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.serverCode).toContain('server.addService');
      expect(output.serverCode).toContain('PetService');
    });

    it('should generate handler imports', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.serverCode).toContain("from './handlers.js'");
      expect(output.serverCode).toContain('getPet');
      expect(output.serverCode).toContain('listPets');
    });

    it('should generate server.bindAsync call', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.serverCode).toContain('server.bindAsync');
      expect(output.serverCode).toContain('grpc.ServerCredentials.createInsecure()');
    });

    it('should use configured package name in proto path', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema, { packageName: 'petstore' });

      expect(output.serverCode).toContain('petstore.proto');
    });

    it('should include @generated annotation', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.serverCode).toContain('@generated');
    });
  });

  describe('REST Translation Code Generation', () => {
    it('should generate REST-to-gRPC translation code', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.restTranslationCode).toBeDefined();
      expect(output.restTranslationCode).toContain('RouteMapping');
      expect(output.restTranslationCode).toContain('routeMappings');
    });

    it('should generate route mappings for non-streaming methods', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.restTranslationCode).toContain("grpcService: 'PetService'");
      expect(output.restTranslationCode).toContain("grpcMethod: 'GetPet'");
    });

    it('should skip streaming methods in REST translation', () => {
      const schema = createStreamingSchema();
      const output = generateGrpc(schema);

      // Only Unary should be mapped, streaming methods should be skipped
      expect(output.restTranslationCode).toContain('Skipped');
      expect(output.restTranslationCode).toContain('streaming');
    });

    it('should generate registerRestRoutes function', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.restTranslationCode).toContain('export function registerRestRoutes');
      expect(output.restTranslationCode).toContain('FastifyInstance');
    });

    it('should generate gRPC status to HTTP status mapping', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.restTranslationCode).toContain('grpcStatusToHttp');
      expect(output.restTranslationCode).toContain('NOT_FOUND');
      expect(output.restTranslationCode).toContain('UNAUTHENTICATED');
    });

    it('should generate gRPC call helper', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.restTranslationCode).toContain('callGrpcMethod');
    });

    it('should skip REST translation when disabled', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema, { includeRestTranslation: false });

      expect(output.restTranslationCode).toBeUndefined();
    });
  });

  describe('Service Info', () => {
    it('should build service info for all services', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.serviceInfo).toHaveLength(1);
      expect(output.serviceInfo[0]!.name).toBe('PetService');
    });

    it('should include full service name with package', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema, { packageName: 'petstore' });

      expect(output.serviceInfo[0]!.fullServiceName).toBe('petstore.PetService');
      expect(output.serviceInfo[0]!.packageName).toBe('petstore');
    });

    it('should include method info', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      const methods = output.serviceInfo[0]!.methods;
      expect(methods.length).toBe(4);

      const getPet = methods.find((m) => m.name === 'GetPet');
      expect(getPet).toBeDefined();
      expect(getPet!.clientStreaming).toBe(false);
      expect(getPet!.serverStreaming).toBe(false);
    });

    it('should detect streaming in method info', () => {
      const schema = createStreamingSchema();
      const output = generateGrpc(schema);

      const methods = output.serviceInfo[0]!.methods;

      const unary = methods.find((m) => m.name === 'Unary')!;
      expect(unary.clientStreaming).toBe(false);
      expect(unary.serverStreaming).toBe(false);

      const serverStream = methods.find((m) => m.name === 'ServerStream')!;
      expect(serverStream.clientStreaming).toBe(false);
      expect(serverStream.serverStreaming).toBe(true);

      const clientStream = methods.find((m) => m.name === 'ClientStream')!;
      expect(clientStream.clientStreaming).toBe(true);
      expect(clientStream.serverStreaming).toBe(false);

      const bidiStream = methods.find((m) => m.name === 'BidiStream')!;
      expect(bidiStream.clientStreaming).toBe(true);
      expect(bidiStream.serverStreaming).toBe(true);
    });

    it('should include REST path and method in service info', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      const getPet = output.serviceInfo[0]!.methods.find((m) => m.name === 'GetPet');
      expect(getPet!.restPath).toBe('/pets/:id');
      expect(getPet!.restMethod).toBe('GET');
    });
  });

  describe('Convenience Functions', () => {
    it('generateGrpc should work with default options', () => {
      const schema = createTestSchema();
      const output = generateGrpc(schema);

      expect(output.protoFile).toBeTruthy();
      expect(output.handlerCode).toBeTruthy();
      expect(output.typeDefinitions).toBeTruthy();
      expect(output.serverCode).toBeTruthy();
      expect(output.restTranslationCode).toBeTruthy();
      expect(output.serviceInfo.length).toBeGreaterThan(0);
    });

    it('generateProtoFile should return only proto content', () => {
      const schema = createTestSchema();
      const protoFile = generateProtoFile(schema);

      expect(protoFile).toContain('syntax = "proto3"');
      expect(protoFile).toContain('service PetService');
      expect(typeof protoFile).toBe('string');
    });

    it('generateProtoFile should accept options', () => {
      const schema = createTestSchema();
      const protoFile = generateProtoFile(schema, { packageName: 'custom.pkg' });

      expect(protoFile).toContain('package custom.pkg;');
    });
  });

  describe('GrpcGenerator Class', () => {
    it('should be instantiable with options', () => {
      const generator = new GrpcGenerator({ packageName: 'test' });
      const schema = createTestSchema();
      const output = generator.generate(schema);

      expect(output.protoFile).toContain('package test;');
    });

    it('should be instantiable without options', () => {
      const generator = new GrpcGenerator();
      const schema = createTestSchema();
      const output = generator.generate(schema);

      expect(output.protoFile).toContain('package api;');
    });

    it('should reset state between generates', () => {
      const generator = new GrpcGenerator();
      const schema = createTestSchema();

      const output1 = generator.generate(schema);
      const output2 = generator.generate(schema);

      // Both outputs should be identical
      expect(output1.protoFile).toBe(output2.protoFile);
    });
  });

  describe('Multiple Services', () => {
    it('should handle schema with multiple services', () => {
      const service1 = createService('ServiceA', [
        createMethod(
          'MethodA',
          createObjectType([createField('input', createPrimitiveType('string'), true)], { name: 'MethodARequest' }),
          createObjectType([createField('result', createPrimitiveType('string'), true)], { name: 'MethodAResponse' }),
        ),
      ]);

      const service2 = createService('ServiceB', [
        createMethod(
          'MethodB',
          createObjectType([createField('data', createPrimitiveType('integer'), true)], { name: 'MethodBRequest' }),
          createObjectType([createField('status', createPrimitiveType('boolean'), true)], { name: 'MethodBResponse' }),
        ),
      ]);

      const schema = createSchema([service1, service2], 'protobuf');
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('service ServiceA');
      expect(output.protoFile).toContain('service ServiceB');
      expect(output.serviceInfo).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty service', () => {
      const service = createService('EmptyService', []);
      const schema = createSchema([service], 'protobuf');
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('service EmptyService');
      expect(output.serviceInfo[0]!.methods).toHaveLength(0);
    });

    it('should handle schema with no services', () => {
      const schema = createSchema([], 'protobuf');
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('syntax = "proto3"');
      expect(output.serviceInfo).toHaveLength(0);
    });

    it('should handle any type', () => {
      const service = createService('AnyService', [
        createMethod(
          'HandleAny',
          createAnyType(),
          createAnyType(),
        ),
      ]);
      const schema = createSchema([service], 'protobuf');
      const output = generateGrpc(schema);

      expect(output.protoFile).toBeTruthy();
    });

    it('should handle deeply nested object types', () => {
      const innerType = createObjectType(
        [createField('value', createPrimitiveType('string'), true)],
        { name: 'InnerType' }
      );
      const outerType = createObjectType(
        [createField('inner', innerType, true)],
        { name: 'OuterType' }
      );

      const service = createService('NestedService', [
        createMethod('NestedMethod', outerType, outerType),
      ]);
      const schema = createSchema([service], 'protobuf');
      const output = generateGrpc(schema);

      expect(output.protoFile).toContain('message OuterType');
      expect(output.protoFile).toContain('message InnerType');
    });
  });

  describe('Round-trip with Protobuf Parser', () => {
    let parsedSchema: IRSchema;

    beforeAll(async () => {
      parsedSchema = await parseProtobufFile(GREETER_PROTO);
    });

    it('should generate proto from parsed proto schema', () => {
      const output = generateGrpc(parsedSchema, { packageName: 'greeter' });

      expect(output.protoFile).toContain('syntax = "proto3"');
      expect(output.protoFile).toContain('package greeter;');
      expect(output.protoFile).toContain('service Greeter');
      expect(output.protoFile).toContain('service UserService');
    });

    it('should preserve service methods in round-trip', () => {
      const output = generateGrpc(parsedSchema);

      expect(output.protoFile).toContain('SayHello');
      expect(output.protoFile).toContain('SayHelloServerStream');
      expect(output.protoFile).toContain('SayHelloClientStream');
      expect(output.protoFile).toContain('SayHelloBidi');
    });

    it('should preserve streaming annotations in round-trip', () => {
      const output = generateGrpc(parsedSchema);

      // Server stream
      expect(output.protoFile).toMatch(/rpc SayHelloServerStream.*returns \(stream/);

      // Client stream
      expect(output.protoFile).toMatch(/rpc SayHelloClientStream \(stream/);

      // Bidi stream
      expect(output.protoFile).toMatch(/rpc SayHelloBidi \(stream.*returns \(stream/);
    });

    it('should generate complete output for parsed proto', () => {
      const output = generateGrpc(parsedSchema);

      expect(output.handlerCode).toBeTruthy();
      expect(output.typeDefinitions).toBeTruthy();
      expect(output.serverCode).toBeTruthy();
      expect(output.serviceInfo.length).toBe(2); // Greeter + UserService
    });

    it('should generate handler code for streaming methods', () => {
      const output = generateGrpc(parsedSchema);

      // Server streaming handler
      expect(output.handlerCode).toContain('ServerWritableStream');

      // Client streaming handler
      expect(output.handlerCode).toContain('ServerReadableStream');

      // Bidi streaming handler
      expect(output.handlerCode).toContain('ServerDuplexStream');
    });
  });
});
