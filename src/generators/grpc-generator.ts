/**
 * gRPC Generator
 *
 * Generates gRPC service definitions and handler scaffolding from IR.
 * Produces .proto file content and grpc-js handler registration code.
 */

import type {
  IRSchema,
  IRService,
  IRMethod,
  IRType,
} from '../parsers/ir.js';
import {
  isPrimitiveType,
  isObjectType,
  isArrayType,
  isEnumType,
  isVoidType,
  isAnyType,
} from '../parsers/ir.js';
import { GeneratorError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for gRPC generation
 */
export interface GrpcGeneratorOptions {
  /** Proto package name */
  packageName?: string;
  /** Proto syntax version */
  protoSyntax?: 'proto3';
  /** Whether to generate handler scaffolding code */
  generateHandlers?: boolean;
  /** Whether to generate TypeScript type definitions */
  generateTypes?: boolean;
  /** Server port for generated code */
  serverPort?: number;
  /** Whether to include REST-to-gRPC translation helpers */
  includeRestTranslation?: boolean;
}

/**
 * Output of the gRPC generator
 */
export interface GrpcGeneratorOutput {
  /** Generated .proto file content */
  protoFile: string;
  /** Generated handler scaffolding (TypeScript) */
  handlerCode: string;
  /** Generated TypeScript type definitions */
  typeDefinitions: string;
  /** Generated server bootstrap code */
  serverCode: string;
  /** REST-to-gRPC translation helper code */
  restTranslationCode?: string;
  /** Service info for runtime use */
  serviceInfo: GrpcServiceInfo[];
}

/**
 * Information about a generated gRPC service
 */
export interface GrpcServiceInfo {
  /** Service name */
  name: string;
  /** Package name */
  packageName: string;
  /** Full service path (package.ServiceName) */
  fullServiceName: string;
  /** Methods in the service */
  methods: GrpcMethodInfo[];
}

/**
 * Information about a generated gRPC method
 */
export interface GrpcMethodInfo {
  /** Method name */
  name: string;
  /** Request message type name */
  requestType: string;
  /** Response message type name */
  responseType: string;
  /** Whether client streams */
  clientStreaming: boolean;
  /** Whether server streams */
  serverStreaming: boolean;
  /** REST path mapping (if applicable) */
  restPath?: string;
  /** REST HTTP method mapping (if applicable) */
  restMethod?: string;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<GrpcGeneratorOptions> = {
  packageName: 'api',
  protoSyntax: 'proto3',
  generateHandlers: true,
  generateTypes: true,
  serverPort: 50051,
  includeRestTranslation: true,
};

// ============================================================================
// Helper Functions
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function toPascalCase(str: string): string {
  return str
    .replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(\w)/, (_, c: string) => c.toUpperCase());
}

function toCamelCase(str: string): string {
  return str
    .replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(\w)/, (_, c: string) => c.toLowerCase());
}

// ============================================================================
// GrpcGenerator Class
// ============================================================================

/**
 * Generates gRPC service definitions from IR
 */
export class GrpcGenerator {
  private options: Required<GrpcGeneratorOptions>;
  private messageTypes: Map<string, string> = new Map();
  private enumTypes: Map<string, string> = new Map();

  constructor(options?: GrpcGeneratorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate gRPC output from IR schema
   */
  generate(schema: IRSchema): GrpcGeneratorOutput {
    try {
      this.messageTypes.clear();
      this.enumTypes.clear();

      const serviceInfos: GrpcServiceInfo[] = [];

      // Collect all message types from methods
      for (const service of schema.services) {
        for (const method of service.methods) {
          this.collectMessageTypes(method.input, `${capitalize(method.name)}Request`);
          this.collectMessageTypes(method.output, `${capitalize(method.name)}Response`);
        }
      }

      // Generate proto file
      const protoFile = this.generateProtoFile(schema);

      // Generate handler code
      const handlerCode = this.options.generateHandlers
        ? this.generateHandlerCode(schema)
        : '';

      // Generate type definitions
      const typeDefinitions = this.options.generateTypes
        ? this.generateTypeDefinitions(schema)
        : '';

      // Generate server code
      const serverCode = this.generateServerCode(schema);

      // Build service info
      for (const service of schema.services) {
        serviceInfos.push(this.buildServiceInfo(service));
      }

      // Generate REST translation code
      const restTranslationCode = this.options.includeRestTranslation
        ? this.generateRestTranslationCode(schema)
        : undefined;

      return {
        protoFile,
        handlerCode,
        typeDefinitions,
        serverCode,
        restTranslationCode,
        serviceInfo: serviceInfos,
      };
    } catch (error) {
      throw new GeneratorError(
        `Failed to generate gRPC code: ${error instanceof Error ? error.message : String(error)}`,
        'grpc',
        error instanceof Error ? error : undefined
      );
    }
  }

  // ==========================================================================
  // Proto File Generation
  // ==========================================================================

  /**
   * Generate the .proto file content
   */
  private generateProtoFile(schema: IRSchema): string {
    const lines: string[] = [];

    // Header
    lines.push(`syntax = "${this.options.protoSyntax}";`);
    lines.push('');
    lines.push(`package ${this.options.packageName};`);
    lines.push('');

    // Collect and generate all message and enum types
    const generatedMessages = new Set<string>();
    const generatedEnums = new Set<string>();

    // First, generate all collected enums
    for (const [name, definition] of this.enumTypes) {
      if (!generatedEnums.has(name)) {
        lines.push(definition);
        lines.push('');
        generatedEnums.add(name);
      }
    }

    // Then, generate all collected messages
    for (const [name, definition] of this.messageTypes) {
      if (!generatedMessages.has(name)) {
        lines.push(definition);
        lines.push('');
        generatedMessages.add(name);
      }
    }

    // Generate services
    for (const service of schema.services) {
      lines.push(this.generateProtoService(service));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate a service definition in .proto format
   */
  private generateProtoService(service: IRService): string {
    const lines: string[] = [];

    if (service.description) {
      lines.push(`// ${service.description}`);
    }
    lines.push(`service ${service.name} {`);

    for (const method of service.methods) {
      const requestType = this.getMessageTypeName(method.input, `${capitalize(method.name)}Request`);
      const responseType = this.getMessageTypeName(method.output, `${capitalize(method.name)}Response`);

      if (method.description) {
        lines.push(`  // ${method.description}`);
      }

      const clientStream = method.streaming === 'client' || method.streaming === 'bidi' ? 'stream ' : '';
      const serverStream = method.streaming === 'server' || method.streaming === 'bidi' ? 'stream ' : '';

      lines.push(`  rpc ${method.name} (${clientStream}${requestType}) returns (${serverStream}${responseType});`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Collect message types from IR types
   */
  private collectMessageTypes(type: IRType, defaultName: string): void {
    if (isVoidType(type)) {
      if (!this.messageTypes.has('Empty')) {
        this.messageTypes.set('Empty', 'message Empty {}');
      }
      return;
    }

    if (isObjectType(type)) {
      const name = type.name ?? defaultName;
      if (!this.messageTypes.has(name)) {
        const definition = this.generateProtoMessage(type, name);
        this.messageTypes.set(name, definition);

        // Recursively collect nested types
        for (const field of type.fields) {
          if (isObjectType(field.type)) {
            this.collectMessageTypes(field.type, toPascalCase(field.name));
          } else if (isArrayType(field.type) && isObjectType(field.type.elementType)) {
            this.collectMessageTypes(
              field.type.elementType,
              toPascalCase(field.name) + 'Item'
            );
          } else if (isEnumType(field.type)) {
            this.collectEnumType(field.type, toPascalCase(field.name));
          }
        }
      }
    }

    if (isEnumType(type)) {
      this.collectEnumType(type, defaultName);
    }

    if (isArrayType(type)) {
      // Arrays in proto are represented as repeated fields, so we need the element type
      this.collectMessageTypes(type.elementType, defaultName);
    }
  }

  /**
   * Collect enum types
   */
  private collectEnumType(type: IRType & { kind: 'enum' }, defaultName: string): void {
    const name = type.name ?? defaultName;
    if (!this.enumTypes.has(name)) {
      this.enumTypes.set(name, this.generateProtoEnum(type, name));
    }
  }

  /**
   * Generate a message definition in .proto format
   */
  private generateProtoMessage(type: IRType & { kind: 'object' }, name: string): string {
    const lines: string[] = [];

    if (type.description) {
      lines.push(`// ${type.description}`);
    }
    lines.push(`message ${name} {`);

    let fieldNum = 1;
    for (const field of type.fields) {
      const protoType = this.irTypeToProtoType(field.type, toPascalCase(field.name));
      const repeated = isArrayType(field.type) ? 'repeated ' : '';
      const comment = field.description ? ` // ${field.description}` : '';

      if (isArrayType(field.type)) {
        // For arrays, use the element type
        const elementProtoType = this.irTypeToProtoType(
          field.type.elementType,
          toPascalCase(field.name) + 'Item'
        );
        lines.push(`  ${repeated}${elementProtoType} ${field.name} = ${fieldNum};${comment}`);
      } else {
        lines.push(`  ${repeated}${protoType} ${field.name} = ${fieldNum};${comment}`);
      }

      fieldNum++;
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Generate an enum definition in .proto format
   */
  private generateProtoEnum(type: IRType & { kind: 'enum' }, name: string): string {
    const lines: string[] = [];

    if (type.description) {
      lines.push(`// ${type.description}`);
    }
    lines.push(`enum ${name} {`);

    // Protobuf requires first enum value to be 0
    let hasZero = false;
    const numericValues = type.metadata?.numericValues as Record<string, number> | undefined;

    for (let i = 0; i < type.values.length; i++) {
      const value = type.values[i];
      const numericValue = numericValues ? (numericValues[String(value)] ?? i) : i;
      if (numericValue === 0) {
        hasZero = true;
      }
      lines.push(`  ${String(value).toUpperCase()} = ${numericValue};`);
    }

    // Add default 0 value if none exists
    if (!hasZero && type.values.length > 0) {
      lines.splice(lines.length, 0); // Already handled by values starting at 0
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Convert IR type to proto type string
   */
  private irTypeToProtoType(type: IRType, defaultName: string): string {
    if (isPrimitiveType(type)) {
      return this.primitiveToProtoType(type);
    }

    if (isObjectType(type)) {
      return type.name ?? defaultName;
    }

    if (isArrayType(type)) {
      return this.irTypeToProtoType(type.elementType, defaultName);
    }

    if (isEnumType(type)) {
      return type.name ?? defaultName;
    }

    if (isVoidType(type)) {
      return 'Empty';
    }

    if (isAnyType(type)) {
      return 'google.protobuf.Any';
    }

    return 'string'; // Fallback
  }

  /**
   * Convert IR primitive type to proto type
   */
  private primitiveToProtoType(type: IRType & { kind: 'primitive' }): string {
    switch (type.primitiveType) {
      case 'string':
        if (type.format === 'bytes') {
          return 'bytes';
        }
        if (type.format?.includes('64')) {
          return type.format;
        }
        return 'string';
      case 'number':
        return type.format === 'float' ? 'float' : 'double';
      case 'integer':
        if (type.format?.startsWith('uint')) {
          return type.format;
        }
        return type.format ?? 'int32';
      case 'boolean':
        return 'bool';
    }
  }

  /**
   * Get message type name for an IR type
   */
  private getMessageTypeName(type: IRType, defaultName: string): string {
    if (isVoidType(type)) {
      return 'Empty';
    }
    if (isObjectType(type) && type.name) {
      return type.name;
    }
    return defaultName;
  }

  // ==========================================================================
  // Handler Code Generation
  // ==========================================================================

  /**
   * Generate handler scaffolding code
   */
  private generateHandlerCode(schema: IRSchema): string {
    const lines: string[] = [
      '/**',
      ' * Generated gRPC handler scaffolding',
      ' * @generated',
      ' */',
      '',
      "import type * as grpc from '@grpc/grpc-js';",
      '',
    ];

    for (const service of schema.services) {
      lines.push(`// ============================================================================`);
      lines.push(`// ${service.name} Handlers`);
      lines.push(`// ============================================================================`);
      lines.push('');

      for (const method of service.methods) {
        const requestType = capitalize(method.name) + 'Request';
        const responseType = capitalize(method.name) + 'Response';

        lines.push(`/**`);
        if (method.description) {
          lines.push(` * ${method.description}`);
        }
        lines.push(` */`);

        if (method.streaming === 'bidi') {
          lines.push(`export function ${toCamelCase(method.name)}(`);
          lines.push(`  call: grpc.ServerDuplexStream<${requestType}, ${responseType}>`);
          lines.push(`): void {`);
          lines.push(`  call.on('data', (request: ${requestType}) => {`);
          lines.push(`    // TODO: Process bidirectional stream`);
          lines.push(`    console.log('Received:', request);`);
          lines.push(`    call.write({} as ${responseType});`);
          lines.push(`  });`);
          lines.push(`  call.on('end', () => { call.end(); });`);
        } else if (method.streaming === 'server') {
          lines.push(`export function ${toCamelCase(method.name)}(`);
          lines.push(`  call: grpc.ServerWritableStream<${requestType}, ${responseType}>`);
          lines.push(`): void {`);
          lines.push(`  // TODO: Implement server streaming`);
          lines.push(`  const request = call.request;`);
          lines.push(`  console.log('Request:', request);`);
          lines.push(`  call.write({} as ${responseType});`);
          lines.push(`  call.end();`);
        } else if (method.streaming === 'client') {
          lines.push(`export function ${toCamelCase(method.name)}(`);
          lines.push(`  call: grpc.ServerReadableStream<${requestType}, ${responseType}>,`);
          lines.push(`  callback: grpc.sendUnaryData<${responseType}>`);
          lines.push(`): void {`);
          lines.push(`  const messages: ${requestType}[] = [];`);
          lines.push(`  call.on('data', (request: ${requestType}) => {`);
          lines.push(`    messages.push(request);`);
          lines.push(`  });`);
          lines.push(`  call.on('end', () => {`);
          lines.push(`    // TODO: Process client stream`);
          lines.push(`    callback(null, {} as ${responseType});`);
          lines.push(`  });`);
        } else {
          lines.push(`export function ${toCamelCase(method.name)}(`);
          lines.push(`  call: grpc.ServerUnaryCall<${requestType}, ${responseType}>,`);
          lines.push(`  callback: grpc.sendUnaryData<${responseType}>`);
          lines.push(`): void {`);
          lines.push(`  const request = call.request;`);
          lines.push(`  // TODO: Implement handler`);
          lines.push(`  console.log('Request:', request);`);
          lines.push(`  callback(null, {} as ${responseType});`);
        }

        lines.push('}');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // ==========================================================================
  // Type Definitions Generation
  // ==========================================================================

  /**
   * Generate TypeScript type definitions
   */
  private generateTypeDefinitions(schema: IRSchema): string {
    const lines: string[] = [
      '/**',
      ' * Generated TypeScript types from IR schema',
      ' * @generated',
      ' */',
      '',
    ];

    const generated = new Set<string>();

    // Generate types for all methods
    for (const service of schema.services) {
      for (const method of service.methods) {
        this.generateTypeForIRType(
          method.input,
          `${capitalize(method.name)}Request`,
          lines,
          generated
        );
        this.generateTypeForIRType(
          method.output,
          `${capitalize(method.name)}Response`,
          lines,
          generated
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate TypeScript interface for an IR type
   */
  private generateTypeForIRType(
    type: IRType,
    defaultName: string,
    lines: string[],
    generated: Set<string>
  ): void {
    if (isVoidType(type)) {
      if (!generated.has('Empty')) {
        lines.push('export interface Empty {}');
        lines.push('');
        generated.add('Empty');
      }
      return;
    }

    if (isEnumType(type)) {
      const name = type.name ?? defaultName;
      if (!generated.has(name)) {
        lines.push(`export enum ${name} {`);
        for (const value of type.values) {
          lines.push(`  ${String(value).toUpperCase()} = '${String(value)}',`);
        }
        lines.push('}');
        lines.push('');
        generated.add(name);
      }
      return;
    }

    if (isObjectType(type)) {
      const name = type.name ?? defaultName;
      if (generated.has(name)) {
        return;
      }
      generated.add(name);

      // First generate nested types
      for (const field of type.fields) {
        if (isObjectType(field.type)) {
          this.generateTypeForIRType(
            field.type,
            toPascalCase(field.name),
            lines,
            generated
          );
        } else if (isArrayType(field.type) && isObjectType(field.type.elementType)) {
          this.generateTypeForIRType(
            field.type.elementType,
            toPascalCase(field.name) + 'Item',
            lines,
            generated
          );
        } else if (isEnumType(field.type)) {
          this.generateTypeForIRType(
            field.type,
            toPascalCase(field.name),
            lines,
            generated
          );
        }
      }

      if (type.description) {
        lines.push(`/** ${type.description} */`);
      }
      lines.push(`export interface ${name} {`);

      for (const field of type.fields) {
        const optional = field.required ? '' : '?';
        const tsType = this.irTypeToTsType(field.type, toPascalCase(field.name));
        if (field.description) {
          lines.push(`  /** ${field.description} */`);
        }
        lines.push(`  ${field.name}${optional}: ${tsType};`);
      }

      lines.push('}');
      lines.push('');
    }
  }

  /**
   * Convert IR type to TypeScript type string
   */
  private irTypeToTsType(type: IRType, defaultName: string): string {
    if (isPrimitiveType(type)) {
      switch (type.primitiveType) {
        case 'string':
          return 'string';
        case 'number':
        case 'integer':
          return 'number';
        case 'boolean':
          return 'boolean';
      }
    }

    if (isObjectType(type)) {
      return type.name ?? defaultName;
    }

    if (isArrayType(type)) {
      return `${this.irTypeToTsType(type.elementType, defaultName + 'Item')}[]`;
    }

    if (isEnumType(type)) {
      return type.name ?? defaultName;
    }

    if (isVoidType(type)) {
      return 'Empty';
    }

    if (isAnyType(type)) {
      return 'unknown';
    }

    return 'unknown';
  }

  // ==========================================================================
  // Server Code Generation
  // ==========================================================================

  /**
   * Generate server bootstrap code
   */
  private generateServerCode(schema: IRSchema): string {
    const lines: string[] = [
      '/**',
      ' * Generated gRPC server bootstrap',
      ' * @generated',
      ' */',
      '',
      "import * as grpc from '@grpc/grpc-js';",
      "import * as protoLoader from '@grpc/proto-loader';",
      "import path from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      '',
      'const __dirname = path.dirname(fileURLToPath(import.meta.url));',
      '',
      `const PROTO_PATH = path.join(__dirname, './${this.options.packageName}.proto');`,
      `const PORT = ${this.options.serverPort};`,
      '',
      '// Load proto definition',
      'const packageDefinition = protoLoader.loadSync(PROTO_PATH, {',
      '  keepCase: true,',
      '  longs: String,',
      '  enums: String,',
      '  defaults: true,',
      '  oneofs: true,',
      '});',
      '',
      `const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);`,
      `const pkg = protoDescriptor.${this.options.packageName} as Record<string, unknown>;`,
      '',
    ];

    // Import handlers
    lines.push('// Import handlers');
    for (const service of schema.services) {
      lines.push(`import {`);
      for (const method of service.methods) {
        lines.push(`  ${toCamelCase(method.name)},`);
      }
      lines.push(`} from './handlers.js';`);
    }
    lines.push('');

    // Create and start server
    lines.push('// Create server');
    lines.push('const server = new grpc.Server();');
    lines.push('');

    for (const service of schema.services) {
      lines.push(`// Add ${service.name} service`);
      lines.push(`const ${toCamelCase(service.name)}Service = pkg.${service.name} as grpc.ServiceClientConstructor;`);
      lines.push(`server.addService(${toCamelCase(service.name)}Service.service, {`);
      for (const method of service.methods) {
        lines.push(`  ${method.name}: ${toCamelCase(method.name)},`);
      }
      lines.push('});');
      lines.push('');
    }

    lines.push('// Start server');
    lines.push(`server.bindAsync(`);
    lines.push(`  \`0.0.0.0:\${PORT}\`,`);
    lines.push('  grpc.ServerCredentials.createInsecure(),');
    lines.push('  (err, port) => {');
    lines.push('    if (err) {');
    lines.push("      console.error('Failed to start server:', err);");
    lines.push('      return;');
    lines.push('    }');
    lines.push('    console.log(`gRPC server running on port ${port}`);');
    lines.push('  }');
    lines.push(');');

    return lines.join('\n');
  }

  // ==========================================================================
  // REST Translation Code
  // ==========================================================================

  /**
   * Generate REST-to-gRPC translation helper code
   */
  private generateRestTranslationCode(schema: IRSchema): string {
    const lines: string[] = [
      '/**',
      ' * REST-to-gRPC and gRPC-to-REST translation helpers',
      ' * @generated',
      ' */',
      '',
      "import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';",
      "import * as grpc from '@grpc/grpc-js';",
      '',
      '/**',
      ' * Route mapping from REST to gRPC',
      ' */',
      'export interface RouteMapping {',
      '  /** REST HTTP method */',
      '  httpMethod: string;',
      '  /** REST path pattern */',
      '  path: string;',
      '  /** gRPC service name */',
      '  grpcService: string;',
      '  /** gRPC method name */',
      '  grpcMethod: string;',
      '  /** Parameter extraction function */',
      '  extractParams: (req: FastifyRequest) => Record<string, unknown>;',
      '}',
      '',
      '/**',
      ' * REST route mappings for gRPC services',
      ' */',
      'export const routeMappings: RouteMapping[] = [',
    ];

    for (const service of schema.services) {
      for (const method of service.methods) {
        // Skip streaming methods (they can't be mapped to simple REST)
        if (method.streaming) {
          lines.push(`  // Skipped: ${service.name}.${method.name} (streaming)`);
          continue;
        }

        // Generate REST path from method name
        const restPath = this.generateRestPath(method, service);
        const httpMethod = method.httpMethod ?? this.inferHttpMethod(method);

        lines.push('  {');
        lines.push(`    httpMethod: '${httpMethod}',`);
        lines.push(`    path: '${restPath}',`);
        lines.push(`    grpcService: '${service.name}',`);
        lines.push(`    grpcMethod: '${method.name}',`);
        lines.push('    extractParams: (req) => ({');
        lines.push('      ...req.params as object,');
        lines.push('      ...req.query as object,');
        lines.push('      ...(req.body as object ?? {}),');
        lines.push('    }),');
        lines.push('  },');
      }
    }

    lines.push('];');
    lines.push('');

    // Generate registration function
    lines.push('/**');
    lines.push(' * Register REST routes that proxy to gRPC services');
    lines.push(' */');
    lines.push('export function registerRestRoutes(');
    lines.push('  app: FastifyInstance,');
    lines.push('  grpcClient: grpc.Client,');
    lines.push('  prefix = \'/api\'');
    lines.push('): void {');
    lines.push('  for (const mapping of routeMappings) {');
    lines.push('    const url = `${prefix}${mapping.path}`;');
    lines.push('    app.route({');
    lines.push('      method: mapping.httpMethod as never,');
    lines.push('      url,');
    lines.push('      handler: async (req: FastifyRequest, reply: FastifyReply) => {');
    lines.push('        const params = mapping.extractParams(req);');
    lines.push('        try {');
    lines.push('          const result = await callGrpcMethod(');
    lines.push('            grpcClient,');
    lines.push('            mapping.grpcMethod,');
    lines.push('            params');
    lines.push('          );');
    lines.push('          return reply.send(result);');
    lines.push('        } catch (error) {');
    lines.push('          const grpcError = error as grpc.ServiceError;');
    lines.push('          const statusCode = grpcStatusToHttp(grpcError.code);');
    lines.push('          return reply.status(statusCode).send({');
    lines.push('            error: grpcError.message,');
    lines.push('            code: grpcError.code,');
    lines.push('          });');
    lines.push('        }');
    lines.push('      },');
    lines.push('    });');
    lines.push('  }');
    lines.push('}');
    lines.push('');

    // gRPC status to HTTP status mapping
    lines.push('/**');
    lines.push(' * Map gRPC status codes to HTTP status codes');
    lines.push(' */');
    lines.push('function grpcStatusToHttp(code: number): number {');
    lines.push('  const mapping: Record<number, number> = {');
    lines.push('    0: 200,   // OK');
    lines.push('    1: 499,   // CANCELLED');
    lines.push('    2: 500,   // UNKNOWN');
    lines.push('    3: 400,   // INVALID_ARGUMENT');
    lines.push('    4: 504,   // DEADLINE_EXCEEDED');
    lines.push('    5: 404,   // NOT_FOUND');
    lines.push('    6: 409,   // ALREADY_EXISTS');
    lines.push('    7: 403,   // PERMISSION_DENIED');
    lines.push('    8: 429,   // RESOURCE_EXHAUSTED');
    lines.push('    9: 400,   // FAILED_PRECONDITION');
    lines.push('    10: 409,  // ABORTED');
    lines.push('    11: 400,  // OUT_OF_RANGE');
    lines.push('    12: 501,  // UNIMPLEMENTED');
    lines.push('    13: 500,  // INTERNAL');
    lines.push('    14: 503,  // UNAVAILABLE');
    lines.push('    15: 500,  // DATA_LOSS');
    lines.push('    16: 401,  // UNAUTHENTICATED');
    lines.push('  };');
    lines.push('  return mapping[code] ?? 500;');
    lines.push('}');
    lines.push('');

    // gRPC call helper
    lines.push('/**');
    lines.push(' * Call a gRPC method on the client');
    lines.push(' */');
    lines.push('function callGrpcMethod(');
    lines.push('  client: grpc.Client,');
    lines.push('  method: string,');
    lines.push('  params: Record<string, unknown>');
    lines.push('): Promise<unknown> {');
    lines.push('  return new Promise((resolve, reject) => {');
    lines.push('    const fn = (client as Record<string, Function>)[method];');
    lines.push('    if (typeof fn !== \'function\') {');
    lines.push('      reject(new Error(`Method ${method} not found on gRPC client`));');
    lines.push('      return;');
    lines.push('    }');
    lines.push('    fn.call(client, params, (err: grpc.ServiceError | null, response: unknown) => {');
    lines.push('      if (err) { reject(err); }');
    lines.push('      else { resolve(response); }');
    lines.push('    });');
    lines.push('  });');
    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Generate REST path for a gRPC method
   */
  private generateRestPath(method: IRMethod, service: IRService): string {
    if (method.path) {
      return method.path;
    }

    // Generate path from method name using conventions:
    // GetUser → GET /users/:id
    // ListUsers → GET /users
    // CreateUser → POST /users
    // DeleteUser → DELETE /users/:id
    const name = method.name;
    const servicePath = `/${service.name.toLowerCase().replace(/service$/i, '')}s`;

    if (name.startsWith('List') || name.startsWith('list')) {
      return servicePath;
    }
    if (name.startsWith('Get') || name.startsWith('get')) {
      return `${servicePath}/:id`;
    }
    if (name.startsWith('Create') || name.startsWith('create')) {
      return servicePath;
    }
    if (name.startsWith('Update') || name.startsWith('update')) {
      return `${servicePath}/:id`;
    }
    if (name.startsWith('Delete') || name.startsWith('delete')) {
      return `${servicePath}/:id`;
    }

    // Default: POST with method name
    return `${servicePath}/${name}`;
  }

  /**
   * Infer HTTP method from gRPC method name
   */
  private inferHttpMethod(method: IRMethod): string {
    const name = method.name.toLowerCase();
    if (name.startsWith('get') || name.startsWith('list') || name.startsWith('find')) {
      return 'GET';
    }
    if (name.startsWith('create') || name.startsWith('add')) {
      return 'POST';
    }
    if (name.startsWith('update') || name.startsWith('set')) {
      return 'PUT';
    }
    if (name.startsWith('delete') || name.startsWith('remove')) {
      return 'DELETE';
    }
    return 'POST'; // Default for gRPC
  }

  // ==========================================================================
  // Service Info
  // ==========================================================================

  /**
   * Build service info for runtime use
   */
  private buildServiceInfo(service: IRService): GrpcServiceInfo {
    const methods: GrpcMethodInfo[] = service.methods.map((method) => ({
      name: method.name,
      requestType: this.getMessageTypeName(method.input, `${capitalize(method.name)}Request`),
      responseType: this.getMessageTypeName(method.output, `${capitalize(method.name)}Response`),
      clientStreaming: method.streaming === 'client' || method.streaming === 'bidi',
      serverStreaming: method.streaming === 'server' || method.streaming === 'bidi',
      restPath: method.path,
      restMethod: method.httpMethod,
    }));

    return {
      name: service.name,
      packageName: this.options.packageName,
      fullServiceName: `${this.options.packageName}.${service.name}`,
      methods,
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Generate gRPC code from IR schema
 */
export function generateGrpc(
  schema: IRSchema,
  options?: GrpcGeneratorOptions
): GrpcGeneratorOutput {
  const generator = new GrpcGenerator(options);
  return generator.generate(schema);
}

/**
 * Generate only the .proto file content
 */
export function generateProtoFile(
  schema: IRSchema,
  options?: GrpcGeneratorOptions
): string {
  const generator = new GrpcGenerator(options);
  return generator.generate(schema).protoFile;
}
