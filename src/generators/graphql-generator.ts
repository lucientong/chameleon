/**
 * GraphQL Generator
 *
 * Converts IR (Intermediate Representation) to GraphQL Schema Definition Language (SDL)
 * and resolver functions. This enables exposing REST/gRPC APIs as GraphQL endpoints.
 *
 * Mapping strategy:
 * - GET methods → Query fields
 * - POST/PUT/PATCH/DELETE methods → Mutation fields
 * - IRObjectType → GraphQL Object Type
 * - IRArrayType → GraphQL List
 * - IREnumType → GraphQL Enum
 * - IRUnionType → GraphQL Union
 * - IRPrimitiveType → GraphQL Scalar (String, Int, Float, Boolean)
 */

import type {
  IRSchema,
  IRService,
  IRMethod,
  IRType,
  IRField,
  IRObjectType,
  IREnumType,
  IRUnionType,
} from '../parsers/ir.js';
import {
  isPrimitiveType,
  isObjectType,
  isArrayType,
  isEnumType,
  isUnionType,
  isRefType,
  isAnyType,
  isVoidType,
} from '../parsers/ir.js';
import { GeneratorError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for GraphQL generation
 */
export interface GraphQLGeneratorOptions {
  /** Custom scalar mappings (e.g., { 'date-time': 'DateTime' }) */
  scalarMappings?: Record<string, string>;
  /** Whether to include deprecated fields/types */
  includeDeprecated?: boolean;
  /** Whether to generate input types for mutations */
  generateInputTypes?: boolean;
  /** Prefix for generated input type names */
  inputTypePrefix?: string;
  /** Suffix for generated input type names */
  inputTypeSuffix?: string;
  /** Whether to add descriptions as comments */
  includeDescriptions?: boolean;
}

/**
 * Context object for resolver functions
 */
export interface ResolverContext {
  /** Original request headers */
  headers?: Record<string, string>;
  /** Authenticated user information */
  user?: unknown;
  /** Data loaders for batching */
  loaders?: Record<string, unknown>;
  /** Custom context data */
  [key: string]: unknown;
}

/**
 * Resolver function signature
 */
export type ResolverFn<TArgs = Record<string, unknown>, TResult = unknown> = (
  parent: unknown,
  args: TArgs,
  context: ResolverContext,
  info: unknown
) => TResult | Promise<TResult>;

/**
 * Resolver map structure
 */
export interface ResolverMap {
  Query?: Record<string, ResolverFn>;
  Mutation?: Record<string, ResolverFn>;
  [typeName: string]: Record<string, ResolverFn> | undefined;
}

/**
 * Output of the GraphQL generator
 */
export interface GraphQLGeneratorOutput {
  /** GraphQL Schema Definition Language string */
  typeDefs: string;
  /** Resolver function map (stub implementations) */
  resolvers: ResolverMap;
  /** Map of operation names to their IR method info (for runtime translation) */
  operationMap: Map<string, OperationInfo>;
}

/**
 * Information about a GraphQL operation for runtime translation
 */
export interface OperationInfo {
  /** Original IR method */
  method: IRMethod;
  /** Service the method belongs to */
  serviceName: string;
  /** Whether this is a Query or Mutation */
  operationType: 'Query' | 'Mutation';
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<GraphQLGeneratorOptions> = {
  scalarMappings: {
    'date-time': 'DateTime',
    'date': 'Date',
    'time': 'Time',
    'email': 'String',
    'uri': 'String',
    'uuid': 'ID',
    'byte': 'String',
    'binary': 'String',
  },
  includeDeprecated: true,
  generateInputTypes: true,
  inputTypePrefix: '',
  inputTypeSuffix: 'Input',
  includeDescriptions: true,
};

// ============================================================================
// GraphQL Generator Class
// ============================================================================

/**
 * GraphQL Generator converts IR to GraphQL SDL and resolvers
 */
export class GraphQLGenerator {
  private options: Required<GraphQLGeneratorOptions>;
  private typeDefinitions: Map<string, string> = new Map();
  private inputTypeDefinitions: Map<string, string> = new Map();
  private enumDefinitions: Map<string, string> = new Map();
  private unionDefinitions: Map<string, string> = new Map();
  private operationMap: Map<string, OperationInfo> = new Map();
  private typeCounter = 0;

  constructor(options?: GraphQLGeneratorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate GraphQL schema and resolvers from IR
   */
  generate(schema: IRSchema): GraphQLGeneratorOutput {
    try {
      // Reset state
      this.reset();

      // Collect all types from schema
      this.collectTypes(schema);

      // Build Query and Mutation fields
      const queryFields: string[] = [];
      const mutationFields: string[] = [];
      const queryResolvers: Record<string, ResolverFn> = {};
      const mutationResolvers: Record<string, ResolverFn> = {};

      for (const service of schema.services) {
        const { queries, mutations, qResolvers, mResolvers } =
          this.processService(service);
        queryFields.push(...queries);
        mutationFields.push(...mutations);
        Object.assign(queryResolvers, qResolvers);
        Object.assign(mutationResolvers, mResolvers);
      }

      // Build SDL
      const typeDefs = this.buildSDL(queryFields, mutationFields);

      // Build resolver map
      const resolvers: ResolverMap = {};
      if (Object.keys(queryResolvers).length > 0) {
        resolvers.Query = queryResolvers;
      }
      if (Object.keys(mutationResolvers).length > 0) {
        resolvers.Mutation = mutationResolvers;
      }

      return {
        typeDefs,
        resolvers,
        operationMap: this.operationMap,
      };
    } catch (error) {
      throw new GeneratorError(
        `Failed to generate GraphQL schema: ${error instanceof Error ? error.message : String(error)}`,
        'graphql',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Reset generator state
   */
  private reset(): void {
    this.typeDefinitions.clear();
    this.inputTypeDefinitions.clear();
    this.enumDefinitions.clear();
    this.unionDefinitions.clear();
    this.operationMap.clear();
    this.typeCounter = 0;
  }

  /**
   * Collect all named types from schema
   */
  private collectTypes(schema: IRSchema): void {
    // Collect from schema.types if present
    if (schema.types) {
      for (const [name, type] of schema.types) {
        this.registerType(type, name);
      }
    }

    // Collect from all methods
    for (const service of schema.services) {
      for (const method of service.methods) {
        this.collectTypesFromIRType(method.input);
        this.collectTypesFromIRType(method.output);
        if (method.parameters) {
          for (const param of method.parameters) {
            this.collectTypesFromIRType(param.type);
          }
        }
      }
    }
  }

  /**
   * Recursively collect types from an IR type
   */
  private collectTypesFromIRType(type: IRType): void {
    if (isObjectType(type) && type.name) {
      this.registerType(type, type.name);
      for (const field of type.fields) {
        this.collectTypesFromIRType(field.type);
      }
    } else if (isArrayType(type)) {
      this.collectTypesFromIRType(type.elementType);
    } else if (isEnumType(type) && type.name) {
      this.registerEnum(type, type.name);
    } else if (isUnionType(type) && type.name) {
      this.registerUnion(type, type.name);
      for (const variant of type.variants) {
        this.collectTypesFromIRType(variant);
      }
    } else if (isObjectType(type)) {
      // Anonymous object - collect nested types
      for (const field of type.fields) {
        this.collectTypesFromIRType(field.type);
      }
    }
  }

  /**
   * Register an object type definition
   */
  private registerType(type: IRType, name: string): void {
    if (this.typeDefinitions.has(name)) {
      return;
    }
    if (!isObjectType(type)) {
      return;
    }

    const fields = this.buildObjectFields(type.fields);
    const description = this.formatDescription(type.description);
    const deprecated = type.deprecated ? ' @deprecated' : '';

    this.typeDefinitions.set(
      name,
      `${description}type ${name}${deprecated} {\n${fields}\n}`
    );

    // Generate input type if enabled
    if (this.options.generateInputTypes) {
      const inputName = this.getInputTypeName(name);
      if (!this.inputTypeDefinitions.has(inputName)) {
        const inputFields = this.buildInputFields(type.fields);
        this.inputTypeDefinitions.set(
          inputName,
          `${description}input ${inputName} {\n${inputFields}\n}`
        );
      }
    }
  }

  /**
   * Register an enum type definition
   */
  private registerEnum(type: IREnumType, name: string): void {
    if (this.enumDefinitions.has(name)) {
      return;
    }

    const description = this.formatDescription(type.description);
    const values = type.values
      .map((v) => `  ${this.formatEnumValue(v)}`)
      .join('\n');

    this.enumDefinitions.set(name, `${description}enum ${name} {\n${values}\n}`);
  }

  /**
   * Register a union type definition
   */
  private registerUnion(type: IRUnionType, name: string): void {
    if (this.unionDefinitions.has(name)) {
      return;
    }

    const description = this.formatDescription(type.description);
    const variants = type.variants
      .map((v) => this.getTypeName(v))
      .filter((n) => n !== 'String' && n !== 'Int' && n !== 'Float' && n !== 'Boolean')
      .join(' | ');

    if (variants) {
      this.unionDefinitions.set(name, `${description}union ${name} = ${variants}`);
    }
  }

  /**
   * Process a service and extract Query/Mutation fields
   */
  private processService(service: IRService): {
    queries: string[];
    mutations: string[];
    qResolvers: Record<string, ResolverFn>;
    mResolvers: Record<string, ResolverFn>;
  } {
    const queries: string[] = [];
    const mutations: string[] = [];
    const qResolvers: Record<string, ResolverFn> = {};
    const mResolvers: Record<string, ResolverFn> = {};

    for (const method of service.methods) {
      if (!this.options.includeDeprecated && method.deprecated) {
        continue;
      }

      const { field, resolver, operationType } = this.processMethod(
        method,
        service.name
      );

      if (operationType === 'Query') {
        queries.push(field);
        qResolvers[method.name] = resolver;
      } else {
        mutations.push(field);
        mResolvers[method.name] = resolver;
      }

      // Register operation info
      this.operationMap.set(method.name, {
        method,
        serviceName: service.name,
        operationType,
      });
    }

    return { queries, mutations, qResolvers, mResolvers };
  }

  /**
   * Process a single method and generate field definition
   */
  private processMethod(
    method: IRMethod,
    serviceName: string
  ): {
    field: string;
    resolver: ResolverFn;
    operationType: 'Query' | 'Mutation';
  } {
    const operationType = this.getOperationType(method);
    const args = this.buildMethodArgs(method);
    const returnType = this.convertType(method.output, false);
    const description = this.formatDescription(method.description);
    const deprecated = method.deprecated
      ? ` @deprecated(reason: "This operation is deprecated")`
      : '';

    const field = `${description}  ${method.name}${args}: ${returnType}${deprecated}`;

    // Create stub resolver
    const resolver: ResolverFn = (_parent, _args, _context, _info) => {
      // Stub implementation - will be replaced by runtime translator
      throw new Error(
        `Resolver for ${serviceName}.${method.name} not implemented. ` +
          `Use the runtime translator to connect to the actual backend.`
      );
    };

    return { field, resolver, operationType };
  }

  /**
   * Determine if a method should be a Query or Mutation
   */
  private getOperationType(method: IRMethod): 'Query' | 'Mutation' {
    // GET requests are queries, everything else is a mutation
    if (method.httpMethod === 'GET' || method.httpMethod === 'HEAD') {
      return 'Query';
    }
    // If no HTTP method, assume based on method name prefix
    if (!method.httpMethod) {
      const name = method.name.toLowerCase();
      if (
        name.startsWith('get') ||
        name.startsWith('list') ||
        name.startsWith('find') ||
        name.startsWith('search') ||
        name.startsWith('fetch')
      ) {
        return 'Query';
      }
    }
    return 'Mutation';
  }

  /**
   * Build method arguments string
   */
  private buildMethodArgs(method: IRMethod): string {
    const args: string[] = [];

    // Use parameters if available
    if (method.parameters && method.parameters.length > 0) {
      for (const param of method.parameters) {
        if (!this.options.includeDeprecated && param.deprecated) {
          continue;
        }
        const type = this.convertType(param.type, true);
        const required = param.required ? '!' : '';
        const desc = this.formatArgDescription(param.description);
        args.push(`${desc}${param.name}: ${type}${required}`);
      }
    } else if (!isVoidType(method.input)) {
      // Use input type as a single argument
      const inputType = this.getInputTypeForMethod(method);
      if (inputType) {
        args.push(`input: ${inputType}!`);
      }
    }

    return args.length > 0 ? `(${args.join(', ')})` : '';
  }

  /**
   * Get input type name for a method
   */
  private getInputTypeForMethod(method: IRMethod): string | null {
    if (isVoidType(method.input)) {
      return null;
    }
    if (isObjectType(method.input)) {
      if (method.input.name) {
        return this.getInputTypeName(method.input.name);
      }
      // Generate anonymous input type
      const name = this.generateTypeName(`${method.name}Input`);
      this.registerInputType(method.input, name);
      return name;
    }
    // For non-object types, return the type directly
    return this.convertType(method.input, true);
  }

  /**
   * Register an input type definition
   */
  private registerInputType(type: IRObjectType, name: string): void {
    if (this.inputTypeDefinitions.has(name)) {
      return;
    }

    const fields = this.buildInputFields(type.fields);
    const description = this.formatDescription(type.description);

    this.inputTypeDefinitions.set(
      name,
      `${description}input ${name} {\n${fields}\n}`
    );
  }

  /**
   * Build object type fields
   */
  private buildObjectFields(fields: IRField[]): string {
    return fields
      .filter((f) => this.options.includeDeprecated || !f.deprecated)
      .map((field) => {
        const type = this.convertType(field.type, false);
        const required = field.required ? '!' : '';
        const deprecated = field.deprecated
          ? ' @deprecated(reason: "This field is deprecated")'
          : '';
        const description = this.formatFieldDescription(field.description);
        return `${description}  ${field.name}: ${type}${required}${deprecated}`;
      })
      .join('\n');
  }

  /**
   * Build input type fields
   */
  private buildInputFields(fields: IRField[]): string {
    return fields
      .filter((f) => this.options.includeDeprecated || !f.deprecated)
      .map((field) => {
        const type = this.convertType(field.type, true);
        const required = field.required ? '!' : '';
        const description = this.formatFieldDescription(field.description);
        return `${description}  ${field.name}: ${type}${required}`;
      })
      .join('\n');
  }

  /**
   * Convert IR type to GraphQL type string
   */
  private convertType(type: IRType, isInput: boolean): string {
    if (isPrimitiveType(type)) {
      return this.convertPrimitiveType(type);
    }
    if (isArrayType(type)) {
      const elementType = this.convertType(type.elementType, isInput);
      return `[${elementType}]`;
    }
    if (isEnumType(type)) {
      if (type.name) {
        return type.name;
      }
      // Generate anonymous enum
      const name = this.generateTypeName('Enum');
      this.registerEnum(type, name);
      return name;
    }
    if (isUnionType(type)) {
      if (type.name) {
        return type.name;
      }
      // GraphQL unions can't be used in input types
      if (isInput) {
        return 'String'; // Fallback for input
      }
      const name = this.generateTypeName('Union');
      this.registerUnion(type, name);
      return name;
    }
    if (isObjectType(type)) {
      if (type.name) {
        return isInput ? this.getInputTypeName(type.name) : type.name;
      }
      // Generate anonymous type
      const baseName = this.generateTypeName('Type');
      this.registerType(type, baseName);
      return isInput ? this.getInputTypeName(baseName) : baseName;
    }
    if (isRefType(type)) {
      return isInput ? this.getInputTypeName(type.refName) : type.refName;
    }
    if (isAnyType(type)) {
      return 'JSON'; // Custom scalar for any type
    }
    if (isVoidType(type)) {
      return 'Boolean'; // GraphQL doesn't have void, use Boolean
    }

    return 'String'; // Fallback
  }

  /**
   * Convert primitive type to GraphQL scalar
   */
  private convertPrimitiveType(type: IRType & { kind: 'primitive' }): string {
    // Check format-based scalar mapping
    if (type.format) {
      const mappedScalar = this.options.scalarMappings[type.format];
      if (mappedScalar) {
        return mappedScalar;
      }
    }

    switch (type.primitiveType) {
      case 'string':
        return 'String';
      case 'number':
        return 'Float';
      case 'integer':
        return 'Int';
      case 'boolean':
        return 'Boolean';
      default:
        return 'String';
    }
  }

  /**
   * Format enum value for GraphQL
   */
  private formatEnumValue(value: string | number): string {
    if (typeof value === 'number') {
      return `VALUE_${value}`;
    }
    // Convert to valid GraphQL enum value (UPPER_SNAKE_CASE)
    return value
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^(\d)/, '_$1')
      .toUpperCase();
  }

  /**
   * Get input type name from output type name
   */
  private getInputTypeName(name: string): string {
    return `${this.options.inputTypePrefix}${name}${this.options.inputTypeSuffix}`;
  }

  /**
   * Generate a unique type name
   */
  private generateTypeName(prefix: string): string {
    this.typeCounter++;
    return `${prefix}${this.typeCounter}`;
  }

  /**
   * Format description as GraphQL documentation
   */
  private formatDescription(description?: string): string {
    if (!this.options.includeDescriptions || !description) {
      return '';
    }
    if (description.includes('\n')) {
      return `"""\n${description}\n"""\n`;
    }
    return `"${description.replace(/"/g, '\\"')}"\n`;
  }

  /**
   * Format field description (inline)
   */
  private formatFieldDescription(description?: string): string {
    if (!this.options.includeDescriptions || !description) {
      return '';
    }
    const escaped = description.replace(/"/g, '\\"').replace(/\n/g, ' ');
    return `  "${escaped}"\n`;
  }

  /**
   * Format argument description (inline)
   */
  private formatArgDescription(description?: string): string {
    if (!this.options.includeDescriptions || !description) {
      return '';
    }
    const escaped = description.replace(/"/g, '\\"').replace(/\n/g, ' ');
    return `"${escaped}" `;
  }

  /**
   * Get the GraphQL type name for an IR type
   */
  private getTypeName(type: IRType): string {
    if (isObjectType(type) && type.name) {
      return type.name;
    }
    if (isEnumType(type) && type.name) {
      return type.name;
    }
    if (isUnionType(type) && type.name) {
      return type.name;
    }
    if (isRefType(type)) {
      return type.refName;
    }
    if (isPrimitiveType(type)) {
      return this.convertPrimitiveType(type);
    }
    // For unnamed types, generate a name
    return this.convertType(type, false);
  }

  /**
   * Build the complete SDL string
   */
  private buildSDL(queryFields: string[], mutationFields: string[]): string {
    const sections: string[] = [];

    // Add custom scalars
    const customScalars = new Set<string>();
    for (const scalar of Object.values(this.options.scalarMappings)) {
      if (!['String', 'Int', 'Float', 'Boolean', 'ID'].includes(scalar)) {
        customScalars.add(scalar);
      }
    }
    // Add JSON scalar if we have any types
    customScalars.add('JSON');

    if (customScalars.size > 0) {
      sections.push(
        Array.from(customScalars)
          .map((s) => `scalar ${s}`)
          .join('\n')
      );
    }

    // Add enum definitions
    if (this.enumDefinitions.size > 0) {
      sections.push(Array.from(this.enumDefinitions.values()).join('\n\n'));
    }

    // Add union definitions
    if (this.unionDefinitions.size > 0) {
      sections.push(Array.from(this.unionDefinitions.values()).join('\n\n'));
    }

    // Add type definitions
    if (this.typeDefinitions.size > 0) {
      sections.push(Array.from(this.typeDefinitions.values()).join('\n\n'));
    }

    // Add input type definitions
    if (this.inputTypeDefinitions.size > 0) {
      sections.push(Array.from(this.inputTypeDefinitions.values()).join('\n\n'));
    }

    // Add Query type
    if (queryFields.length > 0) {
      sections.push(`type Query {\n${queryFields.join('\n')}\n}`);
    }

    // Add Mutation type
    if (mutationFields.length > 0) {
      sections.push(`type Mutation {\n${mutationFields.join('\n')}\n}`);
    }

    return sections.join('\n\n') + '\n';
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Generate GraphQL schema from IR schema
 */
export function generateGraphQL(
  schema: IRSchema,
  options?: GraphQLGeneratorOptions
): GraphQLGeneratorOutput {
  const generator = new GraphQLGenerator(options);
  return generator.generate(schema);
}

/**
 * Generate only GraphQL SDL (type definitions)
 */
export function generateGraphQLTypeDefs(
  schema: IRSchema,
  options?: GraphQLGeneratorOptions
): string {
  const generator = new GraphQLGenerator(options);
  return generator.generate(schema).typeDefs;
}
