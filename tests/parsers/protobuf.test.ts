/**
 * Tests for Protobuf Parser
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ProtobufParser,
  parseProtobufFile,
  parseProtobufString,
} from '../../src/parsers/protobuf.js';
import {
  isObjectType,
  isPrimitiveType,
  isEnumType,
  isArrayType,
} from '../../src/parsers/ir.js';
import { ParserError } from '../../src/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const GREETER_PROTO = path.join(FIXTURES_DIR, 'greeter.proto');

describe('ProtobufParser', () => {
  describe('parseFile', () => {
    it('should parse a valid .proto file', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);

      expect(schema.sourceType).toBe('protobuf');
      expect(schema.sourceVersion).toBe('3');
      expect(schema.services.length).toBeGreaterThan(0);
    });

    it('should detect all services', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);

      const serviceNames = schema.services.map((s) => s.name);
      expect(serviceNames).toContain('Greeter');
      expect(serviceNames).toContain('UserService');
    });

    it('should parse service methods', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);

      const greeter = schema.services.find((s) => s.name === 'Greeter');
      expect(greeter).toBeDefined();
      expect(greeter!.methods.length).toBe(4);

      const methodNames = greeter!.methods.map((m) => m.name);
      expect(methodNames).toContain('SayHello');
      expect(methodNames).toContain('SayHelloServerStream');
      expect(methodNames).toContain('SayHelloClientStream');
      expect(methodNames).toContain('SayHelloBidi');
    });

    it('should detect streaming modes', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const greeter = schema.services.find((s) => s.name === 'Greeter')!;

      const sayHello = greeter.methods.find((m) => m.name === 'SayHello')!;
      expect(sayHello.streaming).toBeUndefined();

      const serverStream = greeter.methods.find((m) => m.name === 'SayHelloServerStream')!;
      expect(serverStream.streaming).toBe('server');

      const clientStream = greeter.methods.find((m) => m.name === 'SayHelloClientStream')!;
      expect(clientStream.streaming).toBe('client');

      const bidiStream = greeter.methods.find((m) => m.name === 'SayHelloBidi')!;
      expect(bidiStream.streaming).toBe('bidi');
    });

    it('should set HTTP method to POST for all RPCs', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);

      for (const service of schema.services) {
        for (const method of service.methods) {
          expect(method.httpMethod).toBe('POST');
        }
      }
    });

    it('should generate paths for methods', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const greeter = schema.services.find((s) => s.name === 'Greeter')!;
      const sayHello = greeter.methods.find((m) => m.name === 'SayHello')!;

      expect(sayHello.path).toBeDefined();
      expect(sayHello.path).toContain('Greeter');
      expect(sayHello.path).toContain('SayHello');
    });

    it('should throw ParserError for invalid file', async () => {
      await expect(
        parseProtobufFile('/nonexistent/file.proto')
      ).rejects.toThrow(ParserError);
    });
  });

  describe('Message Type Conversion', () => {
    it('should convert message types to IR object types', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const greeter = schema.services.find((s) => s.name === 'Greeter')!;
      const sayHello = greeter.methods.find((m) => m.name === 'SayHello')!;

      expect(isObjectType(sayHello.input)).toBe(true);
      if (isObjectType(sayHello.input)) {
        expect(sayHello.input.name).toBe('HelloRequest');
        expect(sayHello.input.fields.length).toBeGreaterThan(0);
      }
    });

    it('should convert scalar types correctly', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const greeter = schema.services.find((s) => s.name === 'Greeter')!;
      const sayHello = greeter.methods.find((m) => m.name === 'SayHello')!;

      if (isObjectType(sayHello.input)) {
        // string field
        const nameField = sayHello.input.fields.find((f) => f.name === 'name');
        expect(nameField).toBeDefined();
        expect(isPrimitiveType(nameField!.type)).toBe(true);
        if (isPrimitiveType(nameField!.type)) {
          expect(nameField!.type.primitiveType).toBe('string');
        }

        // int32 field
        const ageField = sayHello.input.fields.find((f) => f.name === 'age');
        expect(ageField).toBeDefined();
        expect(isPrimitiveType(ageField!.type)).toBe(true);
        if (isPrimitiveType(ageField!.type)) {
          expect(ageField!.type.primitiveType).toBe('integer');
        }
      }
    });

    it('should convert response types', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const greeter = schema.services.find((s) => s.name === 'Greeter')!;
      const sayHello = greeter.methods.find((m) => m.name === 'SayHello')!;

      expect(isObjectType(sayHello.output)).toBe(true);
      if (isObjectType(sayHello.output)) {
        expect(sayHello.output.name).toBe('HelloReply');

        const messageField = sayHello.output.fields.find((f) => f.name === 'message');
        expect(messageField).toBeDefined();
        expect(isPrimitiveType(messageField!.type)).toBe(true);

        const timestampField = sayHello.output.fields.find((f) => f.name === 'timestamp');
        expect(timestampField).toBeDefined();
        // int64 is represented as string
        expect(isPrimitiveType(timestampField!.type)).toBe(true);

        const successField = sayHello.output.fields.find((f) => f.name === 'success');
        expect(successField).toBeDefined();
        expect(isPrimitiveType(successField!.type)).toBe(true);
      }
    });

    it('should convert enum types', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const greeter = schema.services.find((s) => s.name === 'Greeter')!;
      const sayHello = greeter.methods.find((m) => m.name === 'SayHello')!;

      if (isObjectType(sayHello.input)) {
        const genderField = sayHello.input.fields.find((f) => f.name === 'gender');
        expect(genderField).toBeDefined();
        expect(isEnumType(genderField!.type)).toBe(true);

        if (isEnumType(genderField!.type)) {
          expect(genderField!.type.name).toBe('Gender');
          expect(genderField!.type.values).toContain('UNKNOWN');
          expect(genderField!.type.values).toContain('MALE');
          expect(genderField!.type.values).toContain('FEMALE');
        }
      }
    });

    it('should convert nested message types', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const greeter = schema.services.find((s) => s.name === 'Greeter')!;
      const sayHello = greeter.methods.find((m) => m.name === 'SayHello')!;

      if (isObjectType(sayHello.input)) {
        const addressField = sayHello.input.fields.find((f) => f.name === 'address');
        expect(addressField).toBeDefined();
        expect(isObjectType(addressField!.type)).toBe(true);

        if (isObjectType(addressField!.type)) {
          expect(addressField!.type.name).toBe('Address');
          const streetField = addressField!.type.fields.find((f) => f.name === 'street');
          expect(streetField).toBeDefined();
        }
      }
    });

    it('should convert repeated fields to arrays', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const greeter = schema.services.find((s) => s.name === 'Greeter')!;
      const sayHello = greeter.methods.find((m) => m.name === 'SayHello')!;

      if (isObjectType(sayHello.input)) {
        const tagsField = sayHello.input.fields.find((f) => f.name === 'tags');
        expect(tagsField).toBeDefined();
        expect(isArrayType(tagsField!.type)).toBe(true);

        if (isArrayType(tagsField!.type)) {
          expect(isPrimitiveType(tagsField!.type.elementType)).toBe(true);
        }
      }
    });

    it('should convert map fields', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const userService = schema.services.find((s) => s.name === 'UserService')!;

      // GetUser returns User which has a map field
      const getUser = userService.methods.find((m) => m.name === 'GetUser')!;
      if (isObjectType(getUser.output)) {
        const metadataField = getUser.output.fields.find((f) => f.name === 'metadata');
        expect(metadataField).toBeDefined();
        // Map fields should be converted to object types with additionalProperties
        expect(isObjectType(metadataField!.type)).toBe(true);
      }
    });
  });

  describe('UserService', () => {
    it('should parse UserService with all methods', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const userService = schema.services.find((s) => s.name === 'UserService');

      expect(userService).toBeDefined();
      expect(userService!.methods.length).toBe(4);

      const methodNames = userService!.methods.map((m) => m.name);
      expect(methodNames).toContain('GetUser');
      expect(methodNames).toContain('CreateUser');
      expect(methodNames).toContain('ListUsers');
      expect(methodNames).toContain('DeleteUser');
    });

    it('should parse ListUsers response with repeated field', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);
      const userService = schema.services.find((s) => s.name === 'UserService')!;
      const listUsers = userService.methods.find((m) => m.name === 'ListUsers')!;

      expect(isObjectType(listUsers.output)).toBe(true);
      if (isObjectType(listUsers.output)) {
        const usersField = listUsers.output.fields.find((f) => f.name === 'users');
        expect(usersField).toBeDefined();
        expect(isArrayType(usersField!.type)).toBe(true);
      }
    });
  });

  describe('parseString', () => {
    it('should parse a proto string', () => {
      const protoContent = `
        syntax = "proto3";
        package test;
        
        service TestService {
          rpc Echo (EchoRequest) returns (EchoResponse);
        }
        
        message EchoRequest {
          string message = 1;
        }
        
        message EchoResponse {
          string message = 1;
          int32 code = 2;
        }
      `;

      const schema = parseProtobufString(protoContent);

      expect(schema.sourceType).toBe('protobuf');
      expect(schema.services.length).toBe(1);
      expect(schema.services[0]!.name).toBe('TestService');
      expect(schema.services[0]!.methods.length).toBe(1);

      const echoMethod = schema.services[0]!.methods[0]!;
      expect(echoMethod.name).toBe('Echo');
      expect(isObjectType(echoMethod.input)).toBe(true);
      expect(isObjectType(echoMethod.output)).toBe(true);
    });

    it('should handle proto with no services', () => {
      const protoContent = `
        syntax = "proto3";
        package noservice;
        
        message SomeMessage {
          string field1 = 1;
        }
      `;

      const schema = parseProtobufString(protoContent);
      expect(schema.services.length).toBe(0);
    });

    it('should throw ParserError for invalid proto content', () => {
      expect(() => parseProtobufString('this is not valid proto'))
        .toThrow(ParserError);
    });
  });

  describe('Named Types Collection', () => {
    it('should collect named types in the schema', async () => {
      const schema = await parseProtobufFile(GREETER_PROTO);

      // Named types should be populated
      expect(schema.types).toBeDefined();
      expect(schema.types!.size).toBeGreaterThan(0);

      // Check known type names
      expect(schema.types!.has('HelloRequest')).toBe(true);
      expect(schema.types!.has('HelloReply')).toBe(true);
      expect(schema.types!.has('Gender')).toBe(true);
      expect(schema.types!.has('Address')).toBe(true);
      expect(schema.types!.has('User')).toBe(true);
    });
  });

  describe('Static Methods', () => {
    it('should parse file via static method', async () => {
      const schema = await ProtobufParser.parseFile(GREETER_PROTO);
      expect(schema.sourceType).toBe('protobuf');
      expect(schema.services.length).toBeGreaterThan(0);
    });

    it('should parse string via static method', () => {
      const protoContent = `
        syntax = "proto3";
        service Ping { rpc Ping (PingRequest) returns (PingResponse); }
        message PingRequest { string id = 1; }
        message PingResponse { string pong = 1; }
      `;
      const schema = ProtobufParser.parseString(protoContent);
      expect(schema.services.length).toBe(1);
    });
  });
});
