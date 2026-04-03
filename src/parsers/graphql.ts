/**
 * GraphQL SDL Parser
 *
 * Parses GraphQL Schema Definition Language (SDL) strings into the
 * unified IR format. Maps Query fields to GET methods, Mutation fields
 * to POST methods, and Subscription fields to streaming methods.
 */

import {
  parse as parseGraphQL,
  type DocumentNode,
  type TypeNode,
  type FieldDefinitionNode,
  type InputValueDefinitionNode,
  type EnumTypeDefinitionNode,
  type ObjectTypeDefinitionNode,
  type UnionTypeDefinitionNode,
  type InputObjectTypeDefinitionNode,
  type DefinitionNode,
  type NamedTypeNode,
} from 'graphql';
import { readFileSync } from 'fs';
import type {
  IRSchema,
  IRService,
  IRMethod,
  IRType,
  IRField,
  IRParameter,
  HttpMethod,
  StreamingMode,
} from './ir.js';
import {
  createPrimitiveType,
  createObjectType,
  createArrayType,
  createEnumType,
  createUnionType,
  createRefType,
  createVoidType,
  createField,
  createParameter,
  createMethod,
  createService,
  createSchema,
} from './ir.js';
import { ParserError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for GraphQL SDL parsing
 */
export interface GraphQLParseOptions {
  /** Default service name when no grouping is applied */
  defaultServiceName?: string;
  /** Whether to include deprecated fields/types */
  includeDeprecated?: boolean;
  /** Whether to treat Query fields as GET methods */
  mapQueryToGet?: boolean;
  /** Whether to treat Mutation fields as POST methods */
  mapMutationToPost?: boolean;
  /** Whether to treat Subscription as streaming methods */
  mapSubscriptionToStream?: boolean;
}

/**
 * Internal context used during parsing
 */
interface ParseContext {
  /** Named types found in the schema */
  namedTypes: Map<string, IRType>;
  /** Enum definitions */
  enums: Map<string, EnumTypeDefinitionNode>;
  /** Object type definitions */
  objectTypes: Map<string, ObjectTypeDefinitionNode>;
  /** Input object type definitions */
  inputTypes: Map<string, InputObjectTypeDefinitionNode>;
  /** Union type definitions */
  unionTypes: Map<string, UnionTypeDefinitionNode>;
  /** Parse options */
  options: Required<GraphQLParseOptions>;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<GraphQLParseOptions> = {
  defaultServiceName: 'Default',
  includeDeprecated: true,
  mapQueryToGet: true,
  mapMutationToPost: true,
  mapSubscriptionToStream: true,
};

// ============================================================================
// Built-in Scalar Mapping
// ============================================================================

/**
 * Map of GraphQL built-in scalars to IR primitive types
 */
const SCALAR_MAP: Record<string, IRType> = {
  String: createPrimitiveType('string'),
  Int: createPrimitiveType('integer'),
  Float: createPrimitiveType('number'),
  Boolean: createPrimitiveType('boolean'),
  ID: createPrimitiveType('string', { format: 'id' }),
};

// ============================================================================
// GraphQL Parser Class
// ============================================================================

/**
 * Parser for GraphQL Schema Definition Language (SDL)
 */
export class GraphQLSDLParser {
  /**
   * Parse a GraphQL SDL file into IR
   */
  static parseFile(
    filePath: string,
    options?: GraphQLParseOptions
  ): IRSchema {
    try {
      const sdl = readFileSync(filePath, 'utf-8');
      return GraphQLSDLParser.parseString(sdl, options);
    } catch (error) {
      if (error instanceof ParserError) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : String(error);
      throw new ParserError(
        `Failed to read GraphQL SDL file: ${message}`,
        'graphql',
        { file: filePath },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Parse a GraphQL SDL string into IR
   */
  static parseString(
    sdl: string,
    options?: GraphQLParseOptions
  ): IRSchema {
    const opts: Required<GraphQLParseOptions> = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    // Parse SDL to AST
    let document: DocumentNode;
    try {
      document = parseGraphQL(sdl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new ParserError(
        `Failed to parse GraphQL SDL: ${message}`,
        'graphql',
        undefined,
        error instanceof Error ? error : undefined
      );
    }

    // Build parse context
    const ctx = buildContext(document, opts);

    // Resolve all named types
    resolveNamedTypes(ctx);

    // Extract services from Query, Mutation, Subscription
    const services: IRService[] = [];

    const queryType = ctx.objectTypes.get('Query');
    const mutationType = ctx.objectTypes.get('Mutation');
    const subscriptionType = ctx.objectTypes.get('Subscription');

    // Collect methods from root types
    const methods: IRMethod[] = [];

    if (queryType?.fields) {
      for (const field of queryType.fields) {
        if (!opts.includeDeprecated && isDeprecated(field)) {
          continue;
        }
        methods.push(
          convertFieldToMethod(field, 'query', ctx)
        );
      }
    }

    if (mutationType?.fields) {
      for (const field of mutationType.fields) {
        if (!opts.includeDeprecated && isDeprecated(field)) {
          continue;
        }
        methods.push(
          convertFieldToMethod(field, 'mutation', ctx)
        );
      }
    }

    if (subscriptionType?.fields) {
      for (const field of subscriptionType.fields) {
        if (!opts.includeDeprecated && isDeprecated(field)) {
          continue;
        }
        methods.push(
          convertFieldToMethod(field, 'subscription', ctx)
        );
      }
    }

    // Group methods into service
    if (methods.length > 0) {
      services.push(
        createService(opts.defaultServiceName, methods)
      );
    }

    // Build types map
    const types = new Map<string, IRType>();
    for (const [name, irType] of ctx.namedTypes) {
      // Skip root operation types
      if (
        name !== 'Query' &&
        name !== 'Mutation' &&
        name !== 'Subscription'
      ) {
        types.set(name, irType);
      }
    }

    return createSchema(services, 'graphql', {
      types: types.size > 0 ? types : undefined,
      metadata: {
        hasQuery: queryType !== undefined,
        hasMutation: mutationType !== undefined,
        hasSubscription: subscriptionType !== undefined,
      },
    });
  }
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build parsing context from document AST
 */
function buildContext(
  document: DocumentNode,
  options: Required<GraphQLParseOptions>
): ParseContext {
  const ctx: ParseContext = {
    namedTypes: new Map(),
    enums: new Map(),
    objectTypes: new Map(),
    inputTypes: new Map(),
    unionTypes: new Map(),
    options,
  };

  for (const def of document.definitions) {
    registerDefinition(def, ctx);
  }

  return ctx;
}

/**
 * Register a top-level definition in the context
 */
function registerDefinition(def: DefinitionNode, ctx: ParseContext): void {
  const kind = def.kind as string;

  if (kind === 'ObjectTypeDefinition') {
    ctx.objectTypes.set(
      (def as ObjectTypeDefinitionNode).name.value,
      def as ObjectTypeDefinitionNode
    );
  } else if (kind === 'InputObjectTypeDefinition') {
    ctx.inputTypes.set(
      (def as InputObjectTypeDefinitionNode).name.value,
      def as InputObjectTypeDefinitionNode
    );
  } else if (kind === 'EnumTypeDefinition') {
    ctx.enums.set(
      (def as EnumTypeDefinitionNode).name.value,
      def as EnumTypeDefinitionNode
    );
  } else if (kind === 'UnionTypeDefinition') {
    ctx.unionTypes.set(
      (def as UnionTypeDefinitionNode).name.value,
      def as UnionTypeDefinitionNode
    );
  } else if (kind === 'ScalarTypeDefinition') {
    const scalarDef = def as ObjectTypeDefinitionNode;
    // Custom scalars map to string by default
    ctx.namedTypes.set(
      scalarDef.name.value,
      createPrimitiveType('string', {
        description: getDescription(scalarDef),
        metadata: { customScalar: true },
      })
    );
  }
  // InterfaceTypeDefinition, SchemaDefinition, etc. are ignored
}

// ============================================================================
// Type Resolution
// ============================================================================

/**
 * Resolve all named types to IR types
 */
function resolveNamedTypes(ctx: ParseContext): void {
  // Resolve enums
  for (const [name, enumDef] of ctx.enums) {
    ctx.namedTypes.set(name, convertEnum(enumDef));
  }

  // Resolve unions
  for (const [name, unionDef] of ctx.unionTypes) {
    ctx.namedTypes.set(name, convertUnion(unionDef, ctx));
  }

  // Resolve object types (may have circular refs)
  for (const [name, objDef] of ctx.objectTypes) {
    if (!ctx.namedTypes.has(name)) {
      ctx.namedTypes.set(name, convertObjectType(objDef, ctx));
    }
  }

  // Resolve input types
  for (const [name, inputDef] of ctx.inputTypes) {
    if (!ctx.namedTypes.has(name)) {
      ctx.namedTypes.set(name, convertInputType(inputDef, ctx));
    }
  }
}

/**
 * Resolve a GraphQL TypeNode to an IRType
 */
function resolveTypeNode(typeNode: TypeNode, ctx: ParseContext): IRType {
  const kind = typeNode.kind as string;

  if (kind === 'NonNullType') {
    // NonNull doesn't change the IR type itself; required-ness
    // is handled at the field/parameter level
    return resolveTypeNode(
      (typeNode as { type: TypeNode }).type,
      ctx
    );
  }

  if (kind === 'ListType') {
    return createArrayType(
      resolveTypeNode((typeNode as { type: TypeNode }).type, ctx)
    );
  }

  if (kind === 'NamedType') {
    const name = (typeNode as NamedTypeNode).name.value;

    // Check built-in scalars
    if (name in SCALAR_MAP) {
      return SCALAR_MAP[name]!;
    }

    // Check if already resolved
    if (ctx.namedTypes.has(name)) {
      return ctx.namedTypes.get(name)!;
    }

    // Try to resolve lazily
    if (ctx.objectTypes.has(name)) {
      const objDef = ctx.objectTypes.get(name)!;
      const resolved = convertObjectType(objDef, ctx);
      ctx.namedTypes.set(name, resolved);
      return resolved;
    }

    if (ctx.inputTypes.has(name)) {
      const inputDef = ctx.inputTypes.get(name)!;
      const resolved = convertInputType(inputDef, ctx);
      ctx.namedTypes.set(name, resolved);
      return resolved;
    }

    if (ctx.enums.has(name)) {
      const enumDef = ctx.enums.get(name)!;
      const resolved = convertEnum(enumDef);
      ctx.namedTypes.set(name, resolved);
      return resolved;
    }

    if (ctx.unionTypes.has(name)) {
      const unionDef = ctx.unionTypes.get(name)!;
      const resolved = convertUnion(unionDef, ctx);
      ctx.namedTypes.set(name, resolved);
      return resolved;
    }

    // Unknown type - use ref
    return createRefType(name);
  }

  return createPrimitiveType('string');
}

// ============================================================================
// Type Converters
// ============================================================================

/**
 * Convert an EnumTypeDefinition to IREnumType
 */
function convertEnum(enumDef: EnumTypeDefinitionNode): IRType {
  const values =
    enumDef.values?.map((v) => v.name.value) ?? [];
  return createEnumType(values, {
    name: enumDef.name.value,
    description: getDescription(enumDef),
  });
}

/**
 * Convert a UnionTypeDefinition to IRUnionType
 */
function convertUnion(
  unionDef: UnionTypeDefinitionNode,
  ctx: ParseContext
): IRType {
  const variants: IRType[] =
    unionDef.types?.map((t) =>
      resolveTypeNode(t, ctx)
    ) ?? [];
  return createUnionType(variants, {
    name: unionDef.name.value,
    description: getDescription(unionDef),
  });
}

/**
 * Convert an ObjectTypeDefinition to IRObjectType
 */
function convertObjectType(
  objDef: ObjectTypeDefinitionNode,
  ctx: ParseContext
): IRType {
  // Register a placeholder to break circular references
  const placeholder = createObjectType([], {
    name: objDef.name.value,
    description: getDescription(objDef),
  });
  ctx.namedTypes.set(objDef.name.value, placeholder);

  const fields: IRField[] =
    objDef.fields?.map((f) => convertFieldDefinition(f, ctx)) ?? [];

  const result = createObjectType(fields, {
    name: objDef.name.value,
    description: getDescription(objDef),
  });

  // Update placeholder in place
  ctx.namedTypes.set(objDef.name.value, result);
  return result;
}

/**
 * Convert an InputObjectTypeDefinition to IRObjectType
 */
function convertInputType(
  inputDef: InputObjectTypeDefinitionNode,
  ctx: ParseContext
): IRType {
  // Register placeholder
  const placeholder = createObjectType([], {
    name: inputDef.name.value,
    description: getDescription(inputDef),
  });
  ctx.namedTypes.set(inputDef.name.value, placeholder);

  const fields: IRField[] =
    inputDef.fields?.map((f) => convertInputFieldDefinition(f, ctx)) ?? [];

  const result = createObjectType(fields, {
    name: inputDef.name.value,
    description: getDescription(inputDef),
    metadata: { isInput: true },
  });

  ctx.namedTypes.set(inputDef.name.value, result);
  return result;
}

/**
 * Convert a FieldDefinitionNode to IRField
 */
function convertFieldDefinition(
  field: FieldDefinitionNode,
  ctx: ParseContext
): IRField {
  const required = (field.type.kind as string) === 'NonNullType';
  const irType = resolveTypeNode(field.type, ctx);

  return createField(field.name.value, irType, required, {
    description: getDescription(field),
    deprecated: isDeprecated(field),
  });
}

/**
 * Convert an InputValueDefinitionNode to IRField
 */
function convertInputFieldDefinition(
  field: InputValueDefinitionNode,
  ctx: ParseContext
): IRField {
  const required = (field.type.kind as string) === 'NonNullType';
  const irType = resolveTypeNode(field.type, ctx);

  return createField(field.name.value, irType, required, {
    description: getDescription(field),
    deprecated: isDeprecated(field),
  });
}

// ============================================================================
// Method Conversion
// ============================================================================

/**
 * Convert a Query/Mutation/Subscription field to an IRMethod
 */
function convertFieldToMethod(
  field: FieldDefinitionNode,
  rootType: 'query' | 'mutation' | 'subscription',
  ctx: ParseContext
): IRMethod {
  const name = field.name.value;
  const description = getDescription(field);
  const deprecated = isDeprecated(field);
  const output = resolveTypeNode(field.type, ctx);

  // Build input type from arguments
  let input: IRType;
  const parameters: IRParameter[] = [];

  if (field.arguments && field.arguments.length > 0) {
    const inputFields: IRField[] = [];

    for (const arg of field.arguments) {
      const argType = resolveTypeNode(arg.type, ctx);
      const argRequired = (arg.type.kind as string) === 'NonNullType';

      inputFields.push(
        createField(arg.name.value, argType, argRequired, {
          description: getDescription(arg),
        })
      );

      // Also create parameters for REST mapping
      parameters.push(
        createParameter(
          arg.name.value,
          argType,
          rootType === 'query' ? 'query' : 'body',
          argRequired,
          { description: getDescription(arg) }
        )
      );
    }

    input = createObjectType(inputFields, {
      name: `${capitalize(name)}Input`,
    });
  } else {
    input = createVoidType();
  }

  // Determine HTTP method and path
  let httpMethod: HttpMethod | undefined;
  let path: string | undefined;
  let streaming: StreamingMode | undefined;

  if (rootType === 'query' && ctx.options.mapQueryToGet) {
    httpMethod = 'GET';
    path = `/${name}`;
  } else if (rootType === 'mutation' && ctx.options.mapMutationToPost) {
    httpMethod = 'POST';
    path = `/${name}`;
  } else if (rootType === 'subscription' && ctx.options.mapSubscriptionToStream) {
    streaming = 'server';
    path = `/${name}`;
  }

  return createMethod(name, input, output, {
    description,
    httpMethod,
    path,
    streaming,
    deprecated,
    parameters: parameters.length > 0 ? parameters : undefined,
    tags: [rootType],
    metadata: { graphqlRootType: rootType },
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get description from a node with description
 */
function getDescription(
  node: { description?: { value: string } | null | undefined }
): string | undefined {
  return node.description?.value ?? undefined;
}

/**
 * Check if a field is deprecated (has @deprecated directive)
 */
function isDeprecated(
  node: { directives?: readonly { name: { value: string } }[] }
): boolean {
  return (
    node.directives?.some((d) => d.name.value === 'deprecated') ?? false
  );
}

/**
 * Capitalize the first letter
 */
function capitalize(str: string): string {
  if (str.length === 0) {
    return str;
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Parse a GraphQL SDL file into IR
 */
export function parseGraphQLFile(
  filePath: string,
  options?: GraphQLParseOptions
): IRSchema {
  return GraphQLSDLParser.parseFile(filePath, options);
}

/**
 * Parse a GraphQL SDL string into IR
 */
export function parseGraphQLString(
  sdl: string,
  options?: GraphQLParseOptions
): IRSchema {
  return GraphQLSDLParser.parseString(sdl, options);
}
