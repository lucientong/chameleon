/**
 * TypeScript Type Generator
 *
 * Converts IR (Intermediate Representation) to TypeScript type definitions.
 * Generated types can be used by client applications for type-safe API calls.
 *
 * Features:
 * - Interface generation for object types
 * - Enum generation (string and numeric)
 * - Union type support
 * - JSDoc comments from descriptions
 * - Optional and required field handling
 * - Array types with proper generics
 */

import type {
  IRSchema,
  IRService,
  IRMethod,
  IRType,
  IRField,
  PrimitiveType,
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
 * Options for TypeScript type generation
 */
export interface TypeGeneratorOptions {
  /** Whether to export all types */
  exportTypes?: boolean;
  /** Whether to use 'type' instead of 'interface' for object types */
  useTypeAlias?: boolean;
  /** Whether to include JSDoc comments */
  includeComments?: boolean;
  /** Whether to mark optional fields with '?' */
  useOptionalMarker?: boolean;
  /** Whether to generate readonly properties */
  readonly?: boolean;
  /** Indentation string (default: 2 spaces) */
  indent?: string;
  /** Whether to generate enum as const objects (for tree-shaking) */
  enumAsConst?: boolean;
  /** Custom primitive type mappings */
  primitiveTypeMappings?: Partial<Record<PrimitiveType, string>>;
  /** Format-specific type mappings */
  formatTypeMappings?: Record<string, string>;
  /** Whether to generate method signatures */
  generateMethods?: boolean;
  /** Prefix for generated type names */
  typePrefix?: string;
  /** Suffix for generated type names */
  typeSuffix?: string;
}

/**
 * Output of the TypeScript type generator
 */
export interface TypeGeneratorOutput {
  /** Generated TypeScript code */
  code: string;
  /** Map of type names to their definitions */
  typeMap: Map<string, string>;
  /** List of generated type names */
  typeNames: string[];
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<TypeGeneratorOptions> = {
  exportTypes: true,
  useTypeAlias: false,
  includeComments: true,
  useOptionalMarker: true,
  readonly: false,
  indent: '  ',
  enumAsConst: false,
  primitiveTypeMappings: {
    string: 'string',
    number: 'number',
    integer: 'number',
    boolean: 'boolean',
  },
  formatTypeMappings: {
    'date-time': 'string', // ISO 8601 string
    'date': 'string',
    'time': 'string',
    'email': 'string',
    'uri': 'string',
    'uuid': 'string',
    'byte': 'string',
    'binary': 'Blob | ArrayBuffer',
    'int32': 'number',
    'int64': 'number', // Note: BigInt in runtime, but number for JSON
    'float': 'number',
    'double': 'number',
  },
  generateMethods: true,
  typePrefix: '',
  typeSuffix: '',
};

// ============================================================================
// TypeScript Type Generator Class
// ============================================================================

/**
 * TypeScript Type Generator converts IR to TypeScript type definitions
 */
export class TypeGenerator {
  private options: Required<TypeGeneratorOptions>;
  private typeDefinitions: Map<string, string> = new Map();
  private enumDefinitions: Map<string, string> = new Map();
  private methodDefinitions: Map<string, string> = new Map();
  private generatedNames: Set<string> = new Set();

  constructor(options?: TypeGeneratorOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      primitiveTypeMappings: {
        ...DEFAULT_OPTIONS.primitiveTypeMappings,
        ...options?.primitiveTypeMappings,
      },
      formatTypeMappings: {
        ...DEFAULT_OPTIONS.formatTypeMappings,
        ...options?.formatTypeMappings,
      },
    };
  }

  /**
   * Generate TypeScript types from IR
   */
  generate(schema: IRSchema): TypeGeneratorOutput {
    try {
      // Reset state
      this.reset();

      // Collect all types from schema
      this.collectTypes(schema);

      // Generate method types if enabled
      if (this.options.generateMethods) {
        this.generateMethodTypes(schema);
      }

      // Build output code
      const code = this.buildCode();

      return {
        code,
        typeMap: new Map([
          ...this.typeDefinitions,
          ...this.enumDefinitions,
          ...this.methodDefinitions,
        ]),
        typeNames: Array.from(this.generatedNames),
      };
    } catch (error) {
      throw new GeneratorError(
        `Failed to generate TypeScript types: ${error instanceof Error ? error.message : String(error)}`,
        'typescript',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Reset generator state
   */
  private reset(): void {
    this.typeDefinitions.clear();
    this.enumDefinitions.clear();
    this.methodDefinitions.clear();
    this.generatedNames.clear();
  }

  /**
   * Collect all types from schema
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
        this.collectTypesFromIRType(method.input, `${method.name}Input`);
        this.collectTypesFromIRType(method.output, `${method.name}Output`);
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
  private collectTypesFromIRType(type: IRType, suggestedName?: string): void {
    if (isObjectType(type)) {
      if (type.name) {
        this.registerType(type, type.name);
      } else if (suggestedName && type.fields.length > 0) {
        this.registerType(type, suggestedName);
      }
      for (const field of type.fields) {
        this.collectTypesFromIRType(field.type);
      }
    } else if (isArrayType(type)) {
      this.collectTypesFromIRType(type.elementType);
    } else if (isEnumType(type) && type.name) {
      this.registerEnum(type, type.name);
    } else if (isUnionType(type)) {
      if (type.name) {
        this.registerUnion(type, type.name);
      }
      for (const variant of type.variants) {
        this.collectTypesFromIRType(variant);
      }
    }
  }

  /**
   * Register an object type definition
   */
  private registerType(type: IRType, name: string): void {
    const fullName = this.getFullTypeName(name);
    if (this.typeDefinitions.has(fullName)) {
      return;
    }
    if (!isObjectType(type)) {
      return;
    }

    this.generatedNames.add(fullName);
    const definition = this.buildObjectType(type, fullName);
    this.typeDefinitions.set(fullName, definition);
  }

  /**
   * Register an enum type definition
   */
  private registerEnum(type: IRType & { kind: 'enum' }, name: string): void {
    const fullName = this.getFullTypeName(name);
    if (this.enumDefinitions.has(fullName)) {
      return;
    }

    this.generatedNames.add(fullName);

    if (this.options.enumAsConst) {
      this.enumDefinitions.set(fullName, this.buildConstEnum(type, fullName));
    } else {
      this.enumDefinitions.set(fullName, this.buildEnum(type, fullName));
    }
  }

  /**
   * Register a union type definition
   */
  private registerUnion(type: IRType & { kind: 'union' }, name: string): void {
    const fullName = this.getFullTypeName(name);
    if (this.typeDefinitions.has(fullName)) {
      return;
    }

    this.generatedNames.add(fullName);
    const definition = this.buildUnionType(type, fullName);
    this.typeDefinitions.set(fullName, definition);
  }

  /**
   * Build object type/interface definition
   */
  private buildObjectType(type: IRType & { kind: 'object' }, name: string): string {
    const { exportTypes, useTypeAlias, readonly } = this.options;
    const exportKeyword = exportTypes ? 'export ' : '';
    const readonlyKeyword = readonly ? 'readonly ' : '';

    const comment = this.buildComment(type.description, type.deprecated);
    const fields = type.fields
      .map((field) => this.buildField(field, readonlyKeyword))
      .join('\n');

    if (useTypeAlias) {
      return `${comment}${exportKeyword}type ${name} = {\n${fields}\n};`;
    }
    return `${comment}${exportKeyword}interface ${name} {\n${fields}\n}`;
  }

  /**
   * Build field definition
   */
  private buildField(field: IRField, readonlyKeyword: string): string {
    const { indent, useOptionalMarker } = this.options;
    const optional = useOptionalMarker && !field.required ? '?' : '';
    const typeStr = this.convertType(field.type);
    const comment = this.buildFieldComment(field);

    return `${comment}${indent}${readonlyKeyword}${field.name}${optional}: ${typeStr};`;
  }

  /**
   * Build enum definition
   */
  private buildEnum(type: IRType & { kind: 'enum' }, name: string): string {
    const { indent, exportTypes } = this.options;
    const exportKeyword = exportTypes ? 'export ' : '';
    const comment = this.buildComment(type.description, type.deprecated);

    const members = type.values
      .map((value) => {
        const memberName = this.formatEnumMemberName(value);
        if (typeof value === 'string') {
          return `${indent}${memberName} = '${value}',`;
        }
        return `${indent}${memberName} = ${value},`;
      })
      .join('\n');

    return `${comment}${exportKeyword}enum ${name} {\n${members}\n}`;
  }

  /**
   * Build const enum (as const object)
   */
  private buildConstEnum(type: IRType & { kind: 'enum' }, name: string): string {
    const { indent, exportTypes } = this.options;
    const exportKeyword = exportTypes ? 'export ' : '';
    const comment = this.buildComment(type.description, type.deprecated);

    const members = type.values
      .map((value) => {
        const memberName = this.formatEnumMemberName(value);
        if (typeof value === 'string') {
          return `${indent}${memberName}: '${value}',`;
        }
        return `${indent}${memberName}: ${value},`;
      })
      .join('\n');

    const constDef = `${comment}${exportKeyword}const ${name} = {\n${members}\n} as const;`;
    const typeDef = `${exportKeyword}type ${name} = (typeof ${name})[keyof typeof ${name}];`;

    return `${constDef}\n\n${typeDef}`;
  }

  /**
   * Build union type definition
   */
  private buildUnionType(type: IRType & { kind: 'union' }, name: string): string {
    const { exportTypes } = this.options;
    const exportKeyword = exportTypes ? 'export ' : '';
    const comment = this.buildComment(type.description, type.deprecated);

    const variants = type.variants.map((v) => this.convertType(v)).join(' | ');

    return `${comment}${exportKeyword}type ${name} = ${variants};`;
  }

  /**
   * Generate method types
   */
  private generateMethodTypes(schema: IRSchema): void {
    for (const service of schema.services) {
      this.generateServiceTypes(service);
    }
  }

  /**
   * Generate types for a service
   */
  private generateServiceTypes(service: IRService): void {
    const { exportTypes } = this.options;
    const exportKeyword = exportTypes ? 'export ' : '';

    // Generate service namespace/interface
    const methods = service.methods
      .map((method) => this.buildMethodSignature(method))
      .join('\n');

    const serviceName = this.getFullTypeName(`${service.name}Service`);
    const comment = this.buildComment(service.description);

    this.generatedNames.add(serviceName);
    this.methodDefinitions.set(
      serviceName,
      `${comment}${exportKeyword}interface ${serviceName} {\n${methods}\n}`
    );
  }

  /**
   * Build method signature
   */
  private buildMethodSignature(method: IRMethod): string {
    const { indent } = this.options;
    const comment = this.buildMethodComment(method);

    // Build parameters
    const params = this.buildMethodParams(method);
    const returnType = this.convertType(method.output);

    return `${comment}${indent}${method.name}(${params}): Promise<${returnType}>;`;
  }

  /**
   * Build method parameters
   */
  private buildMethodParams(method: IRMethod): string {
    if (method.parameters && method.parameters.length > 0) {
      return method.parameters
        .map((param) => {
          const optional = param.required ? '' : '?';
          const type = this.convertType(param.type);
          return `${param.name}${optional}: ${type}`;
        })
        .join(', ');
    }

    if (!isVoidType(method.input)) {
      const inputType = this.convertType(method.input);
      return `input: ${inputType}`;
    }

    return '';
  }

  /**
   * Convert IR type to TypeScript type string
   */
  convertType(type: IRType): string {
    if (isPrimitiveType(type)) {
      return this.convertPrimitiveType(type);
    }
    if (isArrayType(type)) {
      const elementType = this.convertType(type.elementType);
      return `${elementType}[]`;
    }
    if (isEnumType(type)) {
      if (type.name) {
        return this.getFullTypeName(type.name);
      }
      // Inline enum as union
      return type.values
        .map((v) => (typeof v === 'string' ? `'${v}'` : String(v)))
        .join(' | ');
    }
    if (isUnionType(type)) {
      if (type.name) {
        return this.getFullTypeName(type.name);
      }
      return type.variants.map((v) => this.convertType(v)).join(' | ');
    }
    if (isObjectType(type)) {
      if (type.name) {
        return this.getFullTypeName(type.name);
      }
      // Inline anonymous object type
      return this.buildInlineObjectType(type);
    }
    if (isRefType(type)) {
      return this.getFullTypeName(type.refName);
    }
    if (isAnyType(type)) {
      return 'unknown';
    }
    if (isVoidType(type)) {
      return 'void';
    }

    return 'unknown';
  }

  /**
   * Convert primitive type to TypeScript type
   */
  private convertPrimitiveType(type: IRType & { kind: 'primitive' }): string {
    // Check format-specific mapping first
    if (type.format) {
      const mappedType = this.options.formatTypeMappings[type.format];
      if (mappedType) {
        return mappedType;
      }
    }

    // Use primitive type mapping
    return this.options.primitiveTypeMappings[type.primitiveType] ?? 'unknown';
  }

  /**
   * Build inline object type
   */
  private buildInlineObjectType(type: IRType & { kind: 'object' }): string {
    if (type.fields.length === 0) {
      return 'Record<string, unknown>';
    }

    const fields = type.fields
      .map((field) => {
        const optional = !field.required ? '?' : '';
        const typeStr = this.convertType(field.type);
        return `${field.name}${optional}: ${typeStr}`;
      })
      .join('; ');

    return `{ ${fields} }`;
  }

  /**
   * Format enum member name
   */
  private formatEnumMemberName(value: string | number): string {
    if (typeof value === 'number') {
      return `Value${value >= 0 ? value : `_${Math.abs(value)}`}`;
    }
    // Convert to valid identifier
    let name = value.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^\d/.test(name)) {
      name = `_${name}`;
    }
    return name;
  }

  /**
   * Get full type name with prefix/suffix
   */
  private getFullTypeName(name: string): string {
    return `${this.options.typePrefix}${name}${this.options.typeSuffix}`;
  }

  /**
   * Build JSDoc comment
   */
  private buildComment(description?: string, deprecated?: boolean): string {
    if (!this.options.includeComments) {
      return '';
    }
    if (!description && !deprecated) {
      return '';
    }

    const lines: string[] = ['/**'];
    if (description) {
      const descLines = description.split('\n');
      for (const line of descLines) {
        lines.push(` * ${line}`);
      }
    }
    if (deprecated) {
      lines.push(' * @deprecated');
    }
    lines.push(' */');

    return lines.join('\n') + '\n';
  }

  /**
   * Build field JSDoc comment
   */
  private buildFieldComment(field: IRField): string {
    if (!this.options.includeComments) {
      return '';
    }
    if (!field.description && !field.deprecated) {
      return '';
    }

    const { indent } = this.options;
    const parts: string[] = [];

    if (field.description) {
      parts.push(field.description.replace(/\n/g, ' '));
    }
    if (field.deprecated) {
      parts.push('@deprecated');
    }

    return `${indent}/** ${parts.join(' ')} */\n`;
  }

  /**
   * Build method JSDoc comment
   */
  private buildMethodComment(method: IRMethod): string {
    if (!this.options.includeComments) {
      return '';
    }
    if (!method.description && !method.deprecated && !method.parameters?.length) {
      return '';
    }

    const { indent } = this.options;
    const lines: string[] = [`${indent}/**`];

    if (method.description) {
      const descLines = method.description.split('\n');
      for (const line of descLines) {
        lines.push(`${indent} * ${line}`);
      }
    }

    if (method.parameters) {
      for (const param of method.parameters) {
        const desc = param.description ? ` - ${param.description}` : '';
        lines.push(`${indent} * @param ${param.name}${desc}`);
      }
    }

    if (method.deprecated) {
      lines.push(`${indent} * @deprecated`);
    }

    lines.push(`${indent} */`);

    return lines.join('\n') + '\n';
  }

  /**
   * Build output code
   */
  private buildCode(): string {
    const sections: string[] = [];

    // Header comment
    sections.push(
      '/**\n * Auto-generated TypeScript types\n * Generated by Chameleon\n */'
    );
    sections.push('');

    // Enum definitions
    if (this.enumDefinitions.size > 0) {
      sections.push('// ============================================================================');
      sections.push('// Enums');
      sections.push('// ============================================================================');
      sections.push('');
      sections.push(Array.from(this.enumDefinitions.values()).join('\n\n'));
      sections.push('');
    }

    // Type definitions
    if (this.typeDefinitions.size > 0) {
      sections.push('// ============================================================================');
      sections.push('// Types');
      sections.push('// ============================================================================');
      sections.push('');
      sections.push(Array.from(this.typeDefinitions.values()).join('\n\n'));
      sections.push('');
    }

    // Method definitions
    if (this.methodDefinitions.size > 0) {
      sections.push('// ============================================================================');
      sections.push('// Services');
      sections.push('// ============================================================================');
      sections.push('');
      sections.push(Array.from(this.methodDefinitions.values()).join('\n\n'));
      sections.push('');
    }

    return sections.join('\n');
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Generate TypeScript types from IR schema
 */
export function generateTypeScript(
  schema: IRSchema,
  options?: TypeGeneratorOptions
): TypeGeneratorOutput {
  const generator = new TypeGenerator(options);
  return generator.generate(schema);
}

/**
 * Generate only TypeScript type code
 */
export function generateTypeScriptCode(
  schema: IRSchema,
  options?: TypeGeneratorOptions
): string {
  const generator = new TypeGenerator(options);
  return generator.generate(schema).code;
}
