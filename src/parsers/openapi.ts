/**
 * OpenAPI 3.x Parser
 *
 * Parses OpenAPI 3.x YAML/JSON schemas and converts them to IR.
 * Uses @apidevtools/swagger-parser for $ref dereferencing and validation.
 *
 * Note: OpenAPI types from 'openapi-types' define `default` as `any`,
 * which triggers ESLint no-unsafe-assignment. We disable these rules
 * at the file level as there's no type-safe way to handle this.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3 } from 'openapi-types';
import { ParserError } from '../errors.js';
import {
  type IRSchema,
  type IRService,
  type IRMethod,
  type IRType,
  type IRField,
  type IRParameter,
  type HttpMethod,
  type ParameterLocation,
  createSchema,
  createService,
  createMethod,
  createField,
  createParameter,
  createPrimitiveType,
  createObjectType,
  createArrayType,
  createEnumType,
  createUnionType,
  createAnyType,
  createVoidType,
} from './ir.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for parsing OpenAPI documents
 */
export interface OpenAPIParseOptions {
  /** Default service name when no tags are present (default: 'Default') */
  defaultServiceName?: string;
  /** Whether to include deprecated operations (default: true) */
  includeDeprecated?: boolean;
  /** Whether to validate the schema before parsing (default: true) */
  validate?: boolean;
}

const DEFAULT_OPTIONS: Required<OpenAPIParseOptions> = {
  defaultServiceName: 'Default',
  includeDeprecated: true,
  validate: true,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Remove undefined values from an object (for exactOptionalPropertyTypes)
 */
function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Type guard for OpenAPI reference objects
 */
function isReferenceObject(
  obj: unknown
): obj is OpenAPIV3.ReferenceObject {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    '$ref' in obj &&
    typeof (obj as Record<string, unknown>)['$ref'] === 'string'
  );
}

/**
 * Type guard to check if schema has items property (array schema)
 */
function hasItemsProperty(
  schema: OpenAPIV3.SchemaObject
): schema is OpenAPIV3.SchemaObject & { items: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject } {
  return 'items' in schema && schema.items !== undefined;
}

// ============================================================================
// OpenAPI Parser Class
// ============================================================================

/**
 * Parser for OpenAPI 3.x specifications
 */
export class OpenAPIParser {
  private options: Required<OpenAPIParseOptions>;
  private document: OpenAPIV3.Document | null = null;

  constructor(options?: OpenAPIParseOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Parse an OpenAPI document from a file path
   */
  static async parseFile(
    filePath: string,
    options?: OpenAPIParseOptions
  ): Promise<IRSchema> {
    const parser = new OpenAPIParser(options);
    return parser.parseFile(filePath);
  }

  /**
   * Parse an OpenAPI document from a JavaScript object
   */
  static async parseDocument(
    document: unknown,
    options?: OpenAPIParseOptions
  ): Promise<IRSchema> {
    const parser = new OpenAPIParser(options);
    return parser.parseDocument(document);
  }

  /**
   * Parse from file path
   */
  async parseFile(filePath: string): Promise<IRSchema> {
    try {
      // Dereference resolves all $ref pointers
      this.document = await SwaggerParser.dereference(filePath) as OpenAPIV3.Document;
      return this.convertToIR();
    } catch (error) {
      throw new ParserError(
        `Failed to parse OpenAPI file: ${filePath}`,
        'openapi',
        { file: filePath },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Parse from document object
   */
  async parseDocument(document: unknown): Promise<IRSchema> {
    try {
      // Validate that document is an object before processing
      if (typeof document !== 'object' || document === null) {
        throw new Error('Document must be a non-null object');
      }
      // Clone to avoid mutating the input - use structured clone pattern
      const docAsRecord = document as Record<string, unknown>;
      const cloned: OpenAPIV3.Document = JSON.parse(JSON.stringify(docAsRecord)) as OpenAPIV3.Document;
      const dereferenced = await SwaggerParser.dereference(cloned);
      this.document = dereferenced as OpenAPIV3.Document;
      return this.convertToIR();
    } catch (error) {
      throw new ParserError(
        'Failed to parse OpenAPI document',
        'openapi',
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Convert the parsed OpenAPI document to IR
   */
  private convertToIR(): IRSchema {
    if (!this.document) {
      throw new ParserError('No document loaded', 'openapi');
    }

    const doc = this.document;
    const serviceMap = new Map<string, IRMethod[]>();
    const types = new Map<string, IRType>();

    // Extract named types from components/schemas
    if (doc.components?.schemas) {
      for (const [name, schema] of Object.entries(doc.components.schemas)) {
        if (!isReferenceObject(schema)) {
          types.set(name, this.convertSchemaToType(schema, name));
        }
      }
    }

    // Process paths
    if (doc.paths) {
      for (const [pathStr, pathItem] of Object.entries(doc.paths)) {
        if (!pathItem) {
          continue;
        }

        // Process each HTTP method
        const methods: Array<[HttpMethod, OpenAPIV3.OperationObject | undefined]> = [
          ['GET', pathItem.get],
          ['POST', pathItem.post],
          ['PUT', pathItem.put],
          ['PATCH', pathItem.patch],
          ['DELETE', pathItem.delete],
          ['HEAD', pathItem.head],
          ['OPTIONS', pathItem.options],
        ];

        for (const [httpMethod, operation] of methods) {
          if (!operation) {
            continue;
          }

          // Skip deprecated if configured
          if (operation.deprecated && !this.options.includeDeprecated) {
            continue;
          }

          const irMethod = this.convertOperationToMethod(
            operation,
            httpMethod,
            pathStr,
            pathItem.parameters
          );

          // Group by tags
          const tags = operation.tags?.length
            ? operation.tags
            : [this.options.defaultServiceName];

          for (const tag of tags) {
            const existingMethods = serviceMap.get(tag) ?? [];
            existingMethods.push(irMethod);
            serviceMap.set(tag, existingMethods);
          }
        }
      }
    }

    // Create services from grouped methods
    const services: IRService[] = [];
    for (const [name, methods] of serviceMap) {
      // Find tag description if available
      const tagInfo = doc.tags?.find((t) => t.name === name);
      services.push(
        createService(name, methods, filterUndefined({
          description: tagInfo?.description,
        }))
      );
    }

    // Sort services by name for deterministic output
    services.sort((a, b) => a.name.localeCompare(b.name));

    return createSchema(services, 'openapi', filterUndefined({
      sourceVersion: doc.openapi,
      title: doc.info.title,
      description: doc.info.description,
      version: doc.info.version,
      types: types.size > 0 ? types : undefined,
      metadata: {
        servers: doc.servers,
        contact: doc.info.contact,
        license: doc.info.license,
      },
    }));
  }

  /**
   * Convert an OpenAPI operation to an IR method
   */
  private convertOperationToMethod(
    operation: OpenAPIV3.OperationObject,
    httpMethod: HttpMethod,
    path: string,
    pathLevelParams?: (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[]
  ): IRMethod {
    const name = this.generateMethodName(operation, httpMethod, path);

    // Combine path-level and operation-level parameters
    const allParams: (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[] = [
      ...(pathLevelParams ?? []),
      ...(operation.parameters ?? []),
    ];

    // Convert parameters
    const parameters: IRParameter[] = [];
    const inputFields: IRField[] = [];

    for (const param of allParams) {
      if (isReferenceObject(param)) {
        continue; // Refs should be resolved by dereference
      }

      const irParam = this.convertParameterToIRParameter(param);
      parameters.push(irParam);

      // Also create input fields for convenience
      inputFields.push(
        createField(param.name, irParam.type, irParam.required, filterUndefined({
          description: param.description,
          deprecated: param.deprecated,
        }))
      );
    }

    // Process request body
    if (operation.requestBody && !isReferenceObject(operation.requestBody)) {
      const bodyType = this.convertRequestBodyToType(operation.requestBody);
      
      // Add body as a special parameter
      parameters.push(
        createParameter('body', bodyType, 'body', operation.requestBody.required ?? false, filterUndefined({
          description: operation.requestBody.description,
        }))
      );

      // For input type, if body is an object, merge its fields
      if (bodyType.kind === 'object') {
        inputFields.push(...bodyType.fields);
      } else {
        inputFields.push(
          createField('body', bodyType, operation.requestBody.required ?? false)
        );
      }
    }

    // Create input type
    const input: IRType = inputFields.length > 0
      ? createObjectType(inputFields)
      : createVoidType();

    // Process response
    const output = this.convertResponsesToType(operation.responses);

    return createMethod(name, input, output, filterUndefined({
      description: operation.summary ?? operation.description,
      httpMethod,
      path,
      parameters: parameters.length > 0 ? parameters : undefined,
      deprecated: operation.deprecated,
      tags: operation.tags,
      metadata: {
        operationId: operation.operationId,
        externalDocs: operation.externalDocs,
        security: operation.security,
      },
    }));
  }

  /**
   * Generate a method name from operation
   */
  private generateMethodName(
    operation: OpenAPIV3.OperationObject,
    httpMethod: HttpMethod,
    path: string
  ): string {
    // Prefer operationId if available
    if (operation.operationId) {
      return this.sanitizeMethodName(operation.operationId);
    }

    // Generate from HTTP method and path
    const pathParts = path
      .split('/')
      .filter(Boolean)
      .map((part) => {
        // Convert {paramName} to ByParamName
        if (part.startsWith('{') && part.endsWith('}')) {
          const paramName = part.slice(1, -1);
          return 'By' + this.capitalize(paramName);
        }
        return this.capitalize(part);
      });

    return this.sanitizeMethodName(
      httpMethod.toLowerCase() + pathParts.join('')
    );
  }

  /**
   * Sanitize a string to be a valid method name
   */
  private sanitizeMethodName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^[0-9]/, '_$&')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Convert an OpenAPI parameter to IR parameter
   */
  private convertParameterToIRParameter(
    param: OpenAPIV3.ParameterObject
  ): IRParameter {
    const type = param.schema && !isReferenceObject(param.schema)
      ? this.convertSchemaToType(param.schema)
      : createAnyType();

    const locationMap: Record<string, ParameterLocation> = {
      path: 'path',
      query: 'query',
      header: 'header',
      cookie: 'cookie',
    };

    // Extract default value safely without using type assertions
    let defaultValue: unknown;
    if (param.schema && !isReferenceObject(param.schema)) {
      defaultValue = param.schema.default;
    }

    return createParameter(
      param.name,
      type,
      locationMap[param.in] ?? 'query',
      param.required ?? param.in === 'path', // Path params are always required
      filterUndefined({
        description: param.description,
        deprecated: param.deprecated,
        defaultValue,
      })
    );
  }

  /**
   * Convert request body to IR type
   */
  private convertRequestBodyToType(
    requestBody: OpenAPIV3.RequestBodyObject
  ): IRType {
    // Prefer JSON content
    const content =
      requestBody.content['application/json'] ??
      requestBody.content['application/x-www-form-urlencoded'] ??
      requestBody.content['multipart/form-data'] ??
      Object.values(requestBody.content)[0];

    if (!content?.schema || isReferenceObject(content.schema)) {
      return createAnyType(filterUndefined({ description: requestBody.description }));
    }

    return this.convertSchemaToType(
      content.schema,
      undefined,
      requestBody.description
    );
  }

  /**
   * Convert responses to IR type (uses success response)
   */
  private convertResponsesToType(
    responses: OpenAPIV3.ResponsesObject
  ): IRType {
    // Find success response (2xx)
    const successResponse =
      responses['200'] ??
      responses['201'] ??
      responses['202'] ??
      responses['204'] ??
      responses['default'];

    if (!successResponse || isReferenceObject(successResponse)) {
      return createVoidType();
    }

    // 204 No Content
    if (!successResponse.content) {
      return createVoidType(filterUndefined({ description: successResponse.description }));
    }

    // Prefer JSON content
    const content =
      successResponse.content['application/json'] ??
      Object.values(successResponse.content)[0];

    if (!content?.schema || isReferenceObject(content.schema)) {
      return createAnyType(filterUndefined({ description: successResponse.description }));
    }

    return this.convertSchemaToType(
      content.schema,
      undefined,
      successResponse.description
    );
  }

  /**
   * Convert an OpenAPI schema to an IR type
   */
  private convertSchemaToType(
    schema: OpenAPIV3.SchemaObject,
    name?: string,
    description?: string
  ): IRType {
    const desc = description ?? schema.description;
    const deprecated = schema.deprecated;

    // Handle allOf (treat as object merge)
    if (schema.allOf) {
      return this.convertAllOfToType(schema.allOf, name, desc);
    }

    // Handle oneOf
    if (schema.oneOf) {
      const variants = schema.oneOf
        .filter((s): s is OpenAPIV3.SchemaObject => !isReferenceObject(s))
        .map((s) => this.convertSchemaToType(s));

      return createUnionType(variants, filterUndefined({
        name,
        description: desc,
        deprecated,
        discriminator: schema.discriminator?.propertyName,
      }));
    }

    // Handle anyOf (treat similar to oneOf)
    if (schema.anyOf) {
      const variants = schema.anyOf
        .filter((s): s is OpenAPIV3.SchemaObject => !isReferenceObject(s))
        .map((s) => this.convertSchemaToType(s));

      return createUnionType(variants, filterUndefined({
        name,
        description: desc,
        deprecated,
      }));
    }

    // Handle enum
    if (schema.enum) {
      const enumValues = schema.enum.filter(
        (v): v is string | number => typeof v === 'string' || typeof v === 'number'
      );
      const schemaDefault = schema.default;
      const enumDefaultValue = (typeof schemaDefault === 'string' || typeof schemaDefault === 'number')
        ? schemaDefault
        : undefined;
      return createEnumType(enumValues, filterUndefined({
        name,
        description: desc,
        deprecated,
        defaultValue: enumDefaultValue,
      }));
    }

    // Handle by type
    switch (schema.type) {
      case 'object':
        return this.convertObjectSchemaToType(schema, name, desc);

      case 'array': {
        // Use type guard to safely check for items property
        if (hasItemsProperty(schema)) {
          return this.convertArraySchemaToType(schema, desc);
        }
        // Fallback for array without items
        return createArrayType(createAnyType(), filterUndefined({ description: desc, deprecated }));
      }

      case 'string': {
        const strDefault = schema.default;
        return createPrimitiveType('string', filterUndefined({
          description: desc,
          deprecated,
          format: schema.format,
          defaultValue: typeof strDefault === 'string' ? strDefault : undefined,
        }));
      }

      case 'number': {
        const numDefault = schema.default;
        return createPrimitiveType('number', filterUndefined({
          description: desc,
          deprecated,
          format: schema.format,
          defaultValue: typeof numDefault === 'number' ? numDefault : undefined,
        }));
      }

      case 'integer': {
        const intDefault = schema.default;
        return createPrimitiveType('integer', filterUndefined({
          description: desc,
          deprecated,
          format: schema.format,
          defaultValue: typeof intDefault === 'number' ? intDefault : undefined,
        }));
      }

      case 'boolean': {
        const boolDefault = schema.default;
        return createPrimitiveType('boolean', filterUndefined({
          description: desc,
          deprecated,
          defaultValue: typeof boolDefault === 'boolean' ? boolDefault : undefined,
        }));
      }

      default:
        // No type specified, check for properties (implicit object)
        if (schema.properties) {
          return this.convertObjectSchemaToType(schema, name, desc);
        }
        // Truly unknown type
        return createAnyType(filterUndefined({ description: desc, deprecated }));
    }
  }

  /**
   * Convert object schema to IR type
   */
  private convertObjectSchemaToType(
    schema: OpenAPIV3.SchemaObject,
    name?: string,
    description?: string
  ): IRType {
    const required = new Set(schema.required ?? []);
    const fields: IRField[] = [];

    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (isReferenceObject(propSchema)) {
          continue; // Should be resolved by dereference
        }

        // Safely extract default value
        const propDefault: unknown = propSchema.default;

        fields.push(
          createField(
            propName,
            this.convertSchemaToType(propSchema),
            required.has(propName),
            filterUndefined({
              description: propSchema.description,
              deprecated: propSchema.deprecated,
              defaultValue: propDefault,
            })
          )
        );
      }
    }

    // Handle additionalProperties
    let additionalProperties: IRType | boolean | undefined;
    if (schema.additionalProperties !== undefined) {
      if (typeof schema.additionalProperties === 'boolean') {
        additionalProperties = schema.additionalProperties;
      } else if (!isReferenceObject(schema.additionalProperties)) {
        additionalProperties = this.convertSchemaToType(
          schema.additionalProperties
        );
      }
    }

    return createObjectType(fields, filterUndefined({
      name,
      description,
      deprecated: schema.deprecated,
      additionalProperties,
    }));
  }

  /**
   * Convert array schema to IR type
   */
  private convertArraySchemaToType(
    schema: OpenAPIV3.SchemaObject & { items: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject },
    description?: string
  ): IRType {
    const items = schema.items;
    const elementType = !isReferenceObject(items)
      ? this.convertSchemaToType(items)
      : createAnyType();

    // Safely access array-specific properties using type narrowing
    const arraySchema = schema as OpenAPIV3.ArraySchemaObject;

    return createArrayType(elementType, filterUndefined({
      description,
      deprecated: schema.deprecated,
      minItems: arraySchema.minItems,
      maxItems: arraySchema.maxItems,
      uniqueItems: arraySchema.uniqueItems,
    }));
  }

  /**
   * Convert allOf to merged object type
   */
  private convertAllOfToType(
    allOf: (OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject)[],
    name?: string,
    description?: string
  ): IRType {
    const mergedFields: IRField[] = [];
    const seenFields = new Set<string>();

    for (const schema of allOf) {
      if (isReferenceObject(schema)) {
        continue;
      }

      const converted = this.convertSchemaToType(schema);
      if (converted.kind === 'object') {
        for (const field of converted.fields) {
          if (!seenFields.has(field.name)) {
            seenFields.add(field.name);
            mergedFields.push(field);
          }
        }
      }
    }

    return createObjectType(mergedFields, filterUndefined({ name, description }));
  }
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Parse an OpenAPI file and return IR schema
 */
export async function parseOpenAPIFile(
  filePath: string,
  options?: OpenAPIParseOptions
): Promise<IRSchema> {
  return OpenAPIParser.parseFile(filePath, options);
}

/**
 * Parse an OpenAPI document and return IR schema
 */
export async function parseOpenAPIDocument(
  document: unknown,
  options?: OpenAPIParseOptions
): Promise<IRSchema> {
  return OpenAPIParser.parseDocument(document, options);
}
