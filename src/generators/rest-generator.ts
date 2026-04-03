/**
 * REST Generator
 *
 * Generates Fastify route configurations from IR (Intermediate Representation).
 * This enables automatic REST API setup from parsed schemas.
 */

import type {
  IRSchema,
  IRService,
  IRMethod,
  IRType,
  IRParameter,
  HttpMethod,
} from '../parsers/ir.js';
import {
  isPrimitiveType,
  isObjectType,
  isArrayType,
  isEnumType,
  isVoidType,
} from '../parsers/ir.js';
import { GeneratorError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Fastify route schema for validation
 */
export interface FastifyRouteSchema {
  params?: Record<string, unknown>;
  querystring?: Record<string, unknown>;
  body?: Record<string, unknown>;
  response?: Record<number, Record<string, unknown>>;
  headers?: Record<string, unknown>;
}

/**
 * Route configuration for Fastify
 */
export interface RouteConfig {
  /** HTTP method */
  method: HttpMethod;
  /** URL path (Fastify format with :param) */
  url: string;
  /** Fastify schema for validation */
  schema: FastifyRouteSchema;
  /** Handler function placeholder name */
  handlerName: string;
  /** Original IR method */
  irMethod: IRMethod;
  /** Service name */
  serviceName: string;
  /** Operation ID for documentation */
  operationId: string;
  /** Description for documentation */
  description?: string;
  /** Tags for documentation */
  tags?: string[];
  /** Whether deprecated */
  deprecated?: boolean;
}

/**
 * Output of the REST generator
 */
export interface RestGeneratorOutput {
  /** Route configurations */
  routes: RouteConfig[];
  /** Generated handler type definitions (TypeScript) */
  handlerTypes: string;
  /** Generated Fastify plugin code */
  pluginCode: string;
  /** Route registration code */
  registrationCode: string;
}

/**
 * Options for REST generation
 */
export interface RestGeneratorOptions {
  /** Prefix for all routes */
  prefix?: string;
  /** Whether to generate JSON Schema for validation */
  generateJsonSchema?: boolean;
  /** Whether to include response schemas */
  includeResponseSchemas?: boolean;
  /** Custom handler name generator */
  handlerNameGenerator?: (method: IRMethod, service: IRService) => string;
  /** Base path to strip from routes */
  stripBasePath?: string;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<RestGeneratorOptions> = {
  prefix: '',
  generateJsonSchema: true,
  includeResponseSchemas: true,
  handlerNameGenerator: (method, service) =>
    `handle${capitalize(service.name)}${capitalize(method.name)}`,
  stripBasePath: '',
};

// ============================================================================
// Helper Functions
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// REST Generator Class
// ============================================================================

/**
 * REST Generator converts IR to Fastify route configurations
 */
export class RestGenerator {
  private options: Required<RestGeneratorOptions>;

  constructor(options?: RestGeneratorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate REST route configurations from IR schema
   */
  generate(schema: IRSchema): RestGeneratorOutput {
    try {
      const routes: RouteConfig[] = [];

      for (const service of schema.services) {
        for (const method of service.methods) {
          if (method.path && method.httpMethod) {
            routes.push(this.generateRoute(method, service));
          }
        }
      }

      return {
        routes,
        handlerTypes: this.generateHandlerTypes(routes),
        pluginCode: this.generatePluginCode(routes),
        registrationCode: this.generateRegistrationCode(routes),
      };
    } catch (error) {
      throw new GeneratorError(
        `Failed to generate REST routes: ${error instanceof Error ? error.message : String(error)}`,
        'rest',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Generate a single route configuration
   */
  private generateRoute(method: IRMethod, service: IRService): RouteConfig {
    // Convert path from OpenAPI format {param} to Fastify format :param
    let url = method.path!;
    url = url.replace(/\{([^}]+)\}/g, ':$1');

    // Apply prefix and strip base path
    if (this.options.stripBasePath && url.startsWith(this.options.stripBasePath)) {
      url = url.slice(this.options.stripBasePath.length);
    }
    if (this.options.prefix) {
      url = `${this.options.prefix}${url}`;
    }

    // Ensure URL starts with /
    if (!url.startsWith('/')) {
      url = `/${url}`;
    }

    return {
      method: method.httpMethod!,
      url,
      schema: this.generateRouteSchema(method),
      handlerName: this.options.handlerNameGenerator(method, service),
      irMethod: method,
      serviceName: service.name,
      operationId: method.name,
      description: method.description,
      tags: method.tags,
      deprecated: method.deprecated,
    };
  }

  /**
   * Generate Fastify route schema
   */
  private generateRouteSchema(method: IRMethod): FastifyRouteSchema {
    const schema: FastifyRouteSchema = {};

    if (!this.options.generateJsonSchema) {
      return schema;
    }

    // Generate params schema
    const pathParams = method.parameters?.filter((p) => p.location === 'path');
    if (pathParams && pathParams.length > 0) {
      schema.params = this.generateParamsSchema(pathParams);
    }

    // Generate querystring schema
    const queryParams = method.parameters?.filter((p) => p.location === 'query');
    if (queryParams && queryParams.length > 0) {
      schema.querystring = this.generateParamsSchema(queryParams);
    }

    // Generate body schema
    if (!isVoidType(method.input) && method.httpMethod !== 'GET' && method.httpMethod !== 'HEAD') {
      const bodyParams = method.parameters?.filter((p) => p.location === 'body');
      if (bodyParams && bodyParams.length > 0) {
        schema.body = this.generateParamsSchema(bodyParams);
      } else {
        schema.body = this.convertTypeToJsonSchema(method.input);
      }
    }

    // Generate response schema
    if (this.options.includeResponseSchemas && !isVoidType(method.output)) {
      schema.response = {
        200: this.convertTypeToJsonSchema(method.output),
      };
    }

    return schema;
  }

  /**
   * Generate JSON Schema from parameters
   */
  private generateParamsSchema(
    params: IRParameter[]
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of params) {
      properties[param.name] = this.convertTypeToJsonSchema(param.type);
      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  /**
   * Convert IR type to JSON Schema
   */
  private convertTypeToJsonSchema(type: IRType): Record<string, unknown> {
    if (isPrimitiveType(type)) {
      return this.convertPrimitiveToJsonSchema(type);
    }

    if (isObjectType(type)) {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const field of type.fields) {
        properties[field.name] = this.convertTypeToJsonSchema(field.type);
        if (field.required) {
          required.push(field.name);
        }
      }

      const schema: Record<string, unknown> = {
        type: 'object',
        properties,
      };

      if (required.length > 0) {
        schema.required = required;
      }

      if (type.additionalProperties === true) {
        schema.additionalProperties = true;
      } else if (type.additionalProperties && typeof type.additionalProperties === 'object') {
        schema.additionalProperties = this.convertTypeToJsonSchema(type.additionalProperties);
      }

      if (type.description) {
        schema.description = type.description;
      }

      return schema;
    }

    if (isArrayType(type)) {
      const schema: Record<string, unknown> = {
        type: 'array',
        items: this.convertTypeToJsonSchema(type.elementType),
      };

      if (type.minItems !== undefined) {
        schema.minItems = type.minItems;
      }
      if (type.maxItems !== undefined) {
        schema.maxItems = type.maxItems;
      }
      if (type.uniqueItems) {
        schema.uniqueItems = true;
      }
      if (type.description) {
        schema.description = type.description;
      }

      return schema;
    }

    if (isEnumType(type)) {
      return {
        type: typeof type.values[0] === 'number' ? 'number' : 'string',
        enum: type.values,
        ...(type.description ? { description: type.description } : {}),
      };
    }

    if (isVoidType(type)) {
      return { type: 'null' };
    }

    // Fallback for any, ref, union
    return {};
  }

  /**
   * Convert primitive type to JSON Schema
   */
  private convertPrimitiveToJsonSchema(
    type: IRType & { kind: 'primitive' }
  ): Record<string, unknown> {
    const schema: Record<string, unknown> = {};

    switch (type.primitiveType) {
      case 'string':
        schema.type = 'string';
        if (type.format) {
          schema.format = type.format;
        }
        break;

      case 'number':
        schema.type = 'number';
        break;

      case 'integer':
        schema.type = 'integer';
        if (type.format) {
          schema.format = type.format;
        }
        break;

      case 'boolean':
        schema.type = 'boolean';
        break;
    }

    if (type.enum) {
      schema.enum = type.enum;
    }

    if (type.description) {
      schema.description = type.description;
    }

    if (type.defaultValue !== undefined) {
      schema.default = type.defaultValue;
    }

    return schema;
  }

  /**
   * Generate TypeScript handler type definitions
   */
  private generateHandlerTypes(routes: RouteConfig[]): string {
    const lines: string[] = [
      '/**',
      ' * Generated handler types for REST routes',
      ' * @generated',
      ' */',
      '',
      "import type { FastifyRequest, FastifyReply } from 'fastify';",
      '',
    ];

    // Generate interface for each route
    for (const route of routes) {
      const { handlerName, irMethod, description, deprecated } = route;

      // Generate JSDoc
      if (description ?? deprecated) {
        lines.push('/**');
        if (description) {
          lines.push(` * ${description}`);
        }
        if (deprecated) {
          lines.push(' * @deprecated');
        }
        lines.push(' */');
      }

      // Generate params type
      const pathParams = irMethod.parameters?.filter((p) => p.location === 'path');
      const queryParams = irMethod.parameters?.filter((p) => p.location === 'query');

      const paramsType = pathParams?.length
        ? this.generateTypeString(pathParams)
        : 'Record<string, never>';

      const queryType = queryParams?.length
        ? this.generateTypeString(queryParams)
        : 'Record<string, never>';

      const bodyType = !isVoidType(irMethod.input)
        ? this.convertTypeToTypeScript(irMethod.input)
        : 'void';

      lines.push(
        `export type ${capitalize(handlerName)}Handler = (`,
        `  request: FastifyRequest<{`,
        `    Params: ${paramsType};`,
        `    Querystring: ${queryType};`,
        `    Body: ${bodyType};`,
        `  }>,`,
        `  reply: FastifyReply`,
        `) => Promise<void>;`,
        ''
      );
    }

    // Generate combined handlers interface
    lines.push('export interface RouteHandlers {');
    for (const route of routes) {
      lines.push(`  ${route.handlerName}: ${capitalize(route.handlerName)}Handler;`);
    }
    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Generate type string from parameters
   */
  private generateTypeString(params: IRParameter[]): string {
    const parts = params.map((p) => {
      const type = this.convertTypeToTypeScript(p.type);
      const optional = p.required ? '' : '?';
      return `${p.name}${optional}: ${type}`;
    });
    return `{ ${parts.join('; ')} }`;
  }

  /**
   * Convert IR type to TypeScript type string
   */
  private convertTypeToTypeScript(type: IRType): string {
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
      if (type.name) {
        return type.name;
      }
      const fields = type.fields.map((f) => {
        const optional = f.required ? '' : '?';
        return `${f.name}${optional}: ${this.convertTypeToTypeScript(f.type)}`;
      });
      return `{ ${fields.join('; ')} }`;
    }

    if (isArrayType(type)) {
      return `Array<${this.convertTypeToTypeScript(type.elementType)}>`;
    }

    if (isEnumType(type)) {
      if (type.name) {
        return type.name;
      }
      return type.values.map((v) => (typeof v === 'string' ? `'${v}'` : v)).join(' | ');
    }

    if (isVoidType(type)) {
      return 'void';
    }

    return 'unknown';
  }

  /**
   * Generate Fastify plugin code
   */
  private generatePluginCode(routes: RouteConfig[]): string {
    const lines: string[] = [
      '/**',
      ' * Generated Fastify plugin for REST routes',
      ' * @generated',
      ' */',
      '',
      "import type { FastifyInstance, FastifyPluginOptions } from 'fastify';",
      "import type { RouteHandlers } from './types';",
      '',
      'export interface PluginOptions extends FastifyPluginOptions {',
      '  handlers: RouteHandlers;',
      '}',
      '',
      'export async function restPlugin(',
      '  fastify: FastifyInstance,',
      '  options: PluginOptions',
      '): Promise<void> {',
      '  const { handlers } = options;',
      '',
    ];

    // Generate route registrations
    for (const route of routes) {
      const { method, url, handlerName, operationId, description, deprecated, schema } = route;

      lines.push(`  // ${operationId}${deprecated ? ' (deprecated)' : ''}`);
      if (description) {
        lines.push(`  // ${description}`);
      }

      lines.push(`  fastify.route({`);
      lines.push(`    method: '${method}',`);
      lines.push(`    url: '${url}',`);

      if (Object.keys(schema).length > 0) {
        lines.push(`    schema: ${JSON.stringify(schema, null, 6).replace(/\n/g, '\n    ')},`);
      }

      lines.push(`    handler: handlers.${handlerName},`);
      lines.push(`  });`);
      lines.push('');
    }

    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Generate route registration code (simpler version)
   */
  private generateRegistrationCode(routes: RouteConfig[]): string {
    const lines: string[] = [
      '/**',
      ' * Route registration helper',
      ' * @generated',
      ' */',
      '',
      'export const routeConfigs = [',
    ];

    for (const route of routes) {
      lines.push('  {');
      lines.push(`    method: '${route.method}' as const,`);
      lines.push(`    url: '${route.url}',`);
      lines.push(`    operationId: '${route.operationId}',`);
      lines.push(`    serviceName: '${route.serviceName}',`);
      if (route.description) {
        lines.push(`    description: '${route.description.replace(/'/g, "\\'")}',`);
      }
      if (route.tags && route.tags.length > 0) {
        lines.push(`    tags: [${route.tags.map((t) => `'${t}'`).join(', ')}],`);
      }
      if (route.deprecated) {
        lines.push(`    deprecated: true,`);
      }
      lines.push('  },');
    }

    lines.push('];');

    return lines.join('\n');
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Generate REST routes from IR schema
 */
export function generateRestRoutes(
  schema: IRSchema,
  options?: RestGeneratorOptions
): RestGeneratorOutput {
  const generator = new RestGenerator(options);
  return generator.generate(schema);
}

/**
 * Generate only route configurations
 */
export function generateRouteConfigs(
  schema: IRSchema,
  options?: RestGeneratorOptions
): RouteConfig[] {
  const generator = new RestGenerator(options);
  return generator.generate(schema).routes;
}
