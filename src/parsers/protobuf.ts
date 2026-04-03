/**
 * Protobuf Parser
 *
 * Parses .proto files (Protocol Buffers) into IR using protobufjs.
 * Supports message types, enums, services with streaming RPCs, nested types,
 * map fields, and oneof fields.
 */

import protobuf from 'protobufjs';
import type {
  IRSchema,
  IRService,
  IRMethod,
  IRType,
  IRField,
  StreamingMode,
} from './ir.js';
import {
  createPrimitiveType,
  createObjectType,
  createArrayType,
  createEnumType,
  createField,
  createMethod,
  createService,
  createSchema,
  createAnyType,
  createVoidType,
} from './ir.js';
import { ParserError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for Protobuf parsing
 */
export interface ProtobufParseOptions {
  /** Default package name if not specified in .proto */
  defaultPackageName?: string;
  /** Whether to include deprecated fields/methods */
  includeDeprecated?: boolean;
  /** Whether to flatten nested message types */
  flattenNestedTypes?: boolean;
  /** Additional proto include paths for resolving imports */
  includePaths?: string[];
}

// ============================================================================
// Protobuf → IR Type Mapping
// ============================================================================

/**
 * Map protobuf scalar types to IR primitive types
 */
function mapScalarType(protoType: string): IRType | null {
  switch (protoType) {
    case 'double':
    case 'float':
      return createPrimitiveType('number', { format: protoType });
    case 'int32':
    case 'sint32':
    case 'uint32':
    case 'fixed32':
    case 'sfixed32':
      return createPrimitiveType('integer', { format: protoType });
    case 'int64':
    case 'sint64':
    case 'uint64':
    case 'fixed64':
    case 'sfixed64':
      // 64-bit integers are represented as strings in JSON
      return createPrimitiveType('string', {
        format: protoType,
        description: '64-bit integer (represented as string in JSON)',
      });
    case 'bool':
      return createPrimitiveType('boolean');
    case 'string':
      return createPrimitiveType('string');
    case 'bytes':
      return createPrimitiveType('string', {
        format: 'bytes',
        description: 'Base64-encoded binary data',
      });
    default:
      return null;
  }
}

// ============================================================================
// ProtobufParser Class
// ============================================================================

/**
 * Parser for Protocol Buffer (.proto) files
 */
export class ProtobufParser {
  private options: Required<ProtobufParseOptions>;
  private typeCache: Map<string, IRType> = new Map();
  private namedTypes: Map<string, IRType> = new Map();

  constructor(options?: ProtobufParseOptions) {
    this.options = {
      defaultPackageName: 'default',
      includeDeprecated: true,
      flattenNestedTypes: true,
      includePaths: [],
      ...options,
    };
  }

  /**
   * Parse a .proto file into IR schema
   */
  async parseFile(filePath: string): Promise<IRSchema> {
    try {
      const root = new protobuf.Root();

      // Add include paths for imports
      if (this.options.includePaths.length > 0) {
        const originalResolvePath = root.resolvePath.bind(root);
        root.resolvePath = (origin: string, target: string): string => {
          // Try each include path
          for (const includePath of this.options.includePaths) {
            const resolved = `${includePath}/${target}`;
            try {
              // Check if file exists by attempting resolution
              return originalResolvePath(includePath, target) ?? resolved;
            } catch {
              // Continue to next path
            }
          }
          return originalResolvePath(origin, target) as string;
        };
      }

      await root.load(filePath);
      root.resolveAll();

      return this.convertRoot(root);
    } catch (error) {
      if (error instanceof ParserError) {
        throw error;
      }
      throw new ParserError(
        `Failed to parse protobuf file: ${error instanceof Error ? error.message : String(error)}`,
        'protobuf',
        { file: filePath },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Parse a .proto string content into IR schema
   */
  parseString(content: string, fileName?: string): IRSchema {
    try {
      const root = protobuf.parse(content, { keepCase: true }).root;
      root.resolveAll();
      return this.convertRoot(root, fileName);
    } catch (error) {
      if (error instanceof ParserError) {
        throw error;
      }
      throw new ParserError(
        `Failed to parse protobuf content: ${error instanceof Error ? error.message : String(error)}`,
        'protobuf',
        { file: fileName },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Convert a protobufjs Root to IR Schema
   */
  private convertRoot(root: protobuf.Root, fileName?: string): IRSchema {
    this.typeCache.clear();
    this.namedTypes.clear();

    const services: IRService[] = [];

    // First pass: collect all message types and enums
    this.collectTypes(root);

    // Second pass: convert services
    this.visitNamespace(root, (obj) => {
      if (obj instanceof protobuf.Service) {
        services.push(this.convertService(obj));
      }
    });

    const schema = createSchema(services, 'protobuf', {
      sourceVersion: '3',
      types: this.namedTypes.size > 0 ? new Map(this.namedTypes) : undefined,
      metadata: {
        fileName,
        packageName: this.getPackageName(root),
      },
    });

    return schema;
  }

  /**
   * Get the package name from the root namespace
   */
  private getPackageName(root: protobuf.Root): string {
    // Look for the first non-root namespace
    for (const nested of root.nestedArray) {
      if (nested instanceof protobuf.Namespace && !(nested instanceof protobuf.Type)) {
        return nested.fullName.replace(/^\./, '');
      }
    }
    return this.options.defaultPackageName;
  }

  /**
   * Visit all objects in a namespace hierarchy
   */
  private visitNamespace(
    ns: protobuf.NamespaceBase,
    callback: (obj: protobuf.ReflectionObject) => void
  ): void {
    for (const nested of ns.nestedArray) {
      callback(nested);
      if (nested instanceof protobuf.Namespace) {
        this.visitNamespace(nested, callback);
      }
    }
  }

  /**
   * Collect all message types and enums from namespace
   */
  private collectTypes(ns: protobuf.NamespaceBase): void {
    this.visitNamespace(ns, (obj) => {
      if (obj instanceof protobuf.Type) {
        const irType = this.convertMessageType(obj);
        const fullName = obj.fullName.replace(/^\./, '');
        this.namedTypes.set(fullName, irType);
        this.namedTypes.set(obj.name, irType);
      } else if (obj instanceof protobuf.Enum) {
        const irType = this.convertEnumType(obj);
        const fullName = obj.fullName.replace(/^\./, '');
        this.namedTypes.set(fullName, irType);
        this.namedTypes.set(obj.name, irType);
      }
    });
  }

  /**
   * Convert a protobuf Service to IR Service
   */
  private convertService(service: protobuf.Service): IRService {
    const methods: IRMethod[] = [];

    for (const method of service.methodsArray) {
      methods.push(this.convertMethod(method, service));
    }

    return createService(service.name, methods, {
      description: service.comment ?? undefined,
      metadata: {
        fullName: service.fullName.replace(/^\./, ''),
        packageName: service.parent
          ? service.parent.fullName.replace(/^\./, '')
          : undefined,
      },
    });
  }

  /**
   * Convert a protobuf Method to IR Method
   */
  private convertMethod(
    method: protobuf.Method,
    service: protobuf.Service
  ): IRMethod {
    // Resolve request and response types
    const resolvedMethod = method.resolve() as protobuf.Method & {
      resolvedRequestType?: protobuf.Type;
      resolvedResponseType?: protobuf.Type;
    };

    const inputType = resolvedMethod.resolvedRequestType
      ? this.convertMessageType(resolvedMethod.resolvedRequestType)
      : createVoidType();

    const outputType = resolvedMethod.resolvedResponseType
      ? this.convertMessageType(resolvedMethod.resolvedResponseType)
      : createVoidType();

    // Determine streaming mode
    let streaming: StreamingMode | undefined;
    if (method.requestStream && method.responseStream) {
      streaming = 'bidi';
    } else if (method.requestStream) {
      streaming = 'client';
    } else if (method.responseStream) {
      streaming = 'server';
    }

    // Generate a default REST-like path for the RPC
    const packageName = service.parent
      ? service.parent.fullName.replace(/^\./, '')
      : '';
    const basePath = packageName
      ? `/${packageName.replace(/\./g, '/')}/${service.name}`
      : `/${service.name}`;

    return createMethod(method.name, inputType, outputType, {
      description: method.comment ?? undefined,
      streaming,
      httpMethod: 'POST', // gRPC uses POST for all RPCs
      path: `${basePath}/${method.name}`,
      metadata: {
        fullName: `${service.fullName.replace(/^\./, '')}.${method.name}`,
        requestStream: method.requestStream ?? false,
        responseStream: method.responseStream ?? false,
        requestTypeName: method.requestType,
        responseTypeName: method.responseType,
      },
    });
  }

  /**
   * Convert a protobuf message Type to IR Object Type
   */
  private convertMessageType(type: protobuf.Type): IRType {
    const cacheKey = type.fullName;
    const cached = this.typeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Create a placeholder to handle circular references
    const placeholder = createObjectType([], { name: type.name });
    this.typeCache.set(cacheKey, placeholder);

    const fields: IRField[] = [];

    // Convert regular fields
    for (const field of type.fieldsArray) {
      fields.push(this.convertField(field));
    }

    const result = createObjectType(fields, {
      name: type.name,
      description: type.comment ?? undefined,
      metadata: {
        fullName: type.fullName.replace(/^\./, ''),
      },
    });

    // Update cache
    this.typeCache.set(cacheKey, result);

    return result;
  }

  /**
   * Convert a protobuf Field to IR Field
   */
  private convertField(field: protobuf.Field): IRField {
    let fieldType: IRType;

    if (field instanceof protobuf.MapField) {
      // Map fields → object with additionalProperties
      const valueType = this.resolveFieldType(field);
      fieldType = createObjectType([], {
        additionalProperties: valueType,
        description: `Map<${field.keyType}, ${field.type}>`,
      });
    } else if (field.repeated) {
      // Repeated fields → array
      const elementType = this.resolveFieldType(field);
      fieldType = createArrayType(elementType);
    } else {
      fieldType = this.resolveFieldType(field);
    }

    // In proto3, all fields are optional by default (no required keyword)
    return createField(field.name, fieldType, false, {
      description: field.comment ?? undefined,
      metadata: {
        fieldNumber: field.id,
        protoType: field.type,
      },
    });
  }

  /**
   * Resolve the IR type for a protobuf field
   */
  private resolveFieldType(field: protobuf.Field): IRType {
    // Try scalar types first
    const scalarType = mapScalarType(field.type);
    if (scalarType) {
      return scalarType;
    }

    // Try to resolve as message or enum
    if (field.resolvedType) {
      if (field.resolvedType instanceof protobuf.Type) {
        return this.convertMessageType(field.resolvedType);
      }
      if (field.resolvedType instanceof protobuf.Enum) {
        return this.convertEnumType(field.resolvedType);
      }
    }

    // Fallback: try to find the type by name
    const typeName = field.type;

    // Check if it's a well-known type
    const wellKnown = this.convertWellKnownType(typeName);
    if (wellKnown) {
      return wellKnown;
    }

    // Unknown type, return any
    return createAnyType({
      description: `Unresolved type: ${typeName}`,
    });
  }

  /**
   * Convert a protobuf Enum to IR Enum Type
   */
  private convertEnumType(enumType: protobuf.Enum): IRType {
    const values = Object.entries(enumType.values).map(([name]) => name);

    return createEnumType(values, {
      name: enumType.name,
      description: enumType.comment ?? undefined,
      metadata: {
        fullName: enumType.fullName.replace(/^\./, ''),
        numericValues: enumType.values,
      },
    });
  }

  /**
   * Convert well-known protobuf types to IR types
   */
  private convertWellKnownType(typeName: string): IRType | null {
    switch (typeName) {
      case 'google.protobuf.Timestamp':
        return createPrimitiveType('string', {
          format: 'date-time',
          description: 'RFC 3339 timestamp',
        });

      case 'google.protobuf.Duration':
        return createPrimitiveType('string', {
          format: 'duration',
          description: 'Duration in seconds with nanosecond precision (e.g., "3.5s")',
        });

      case 'google.protobuf.Empty':
        return createVoidType();

      case 'google.protobuf.Any':
        return createAnyType({
          description: 'google.protobuf.Any',
        });

      case 'google.protobuf.Struct':
        return createObjectType([], {
          additionalProperties: true,
          description: 'google.protobuf.Struct (arbitrary JSON object)',
        });

      case 'google.protobuf.Value':
        return createAnyType({
          description: 'google.protobuf.Value (arbitrary JSON value)',
        });

      case 'google.protobuf.StringValue':
      case 'google.protobuf.BytesValue':
        return createPrimitiveType('string');

      case 'google.protobuf.Int32Value':
      case 'google.protobuf.UInt32Value':
        return createPrimitiveType('integer');

      case 'google.protobuf.Int64Value':
      case 'google.protobuf.UInt64Value':
        return createPrimitiveType('string', { format: 'int64' });

      case 'google.protobuf.FloatValue':
      case 'google.protobuf.DoubleValue':
        return createPrimitiveType('number');

      case 'google.protobuf.BoolValue':
        return createPrimitiveType('boolean');

      default:
        return null;
    }
  }

  /**
   * Static convenience method to parse a file
   */
  static async parseFile(
    filePath: string,
    options?: ProtobufParseOptions
  ): Promise<IRSchema> {
    const parser = new ProtobufParser(options);
    return parser.parseFile(filePath);
  }

  /**
   * Static convenience method to parse a string
   */
  static parseString(
    content: string,
    options?: ProtobufParseOptions
  ): IRSchema {
    const parser = new ProtobufParser(options);
    return parser.parseString(content);
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Parse a .proto file into IR schema
 */
export async function parseProtobufFile(
  filePath: string,
  options?: ProtobufParseOptions
): Promise<IRSchema> {
  return ProtobufParser.parseFile(filePath, options);
}

/**
 * Parse protobuf content string into IR schema
 */
export function parseProtobufString(
  content: string,
  options?: ProtobufParseOptions
): IRSchema {
  return ProtobufParser.parseString(content, options);
}
