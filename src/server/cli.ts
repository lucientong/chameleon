#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Chameleon CLI
 *
 * Command-line interface for starting and managing the Chameleon gateway.
 *
 * Usage:
 *   chameleon start <schema> [options]
 *   chameleon generate <schema> [options]
 *   chameleon validate <schema>
 */

import { Command } from 'commander';
import { resolve, dirname } from 'path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { parseOpenAPIFile } from '../parsers/openapi.js';
import { parseProtobufFile } from '../parsers/protobuf.js';
import { generateGraphQL } from '../generators/graphql-generator.js';
import { generateTypeScript } from '../generators/type-generator.js';
import { generateRestRoutes } from '../generators/rest-generator.js';
import { generateGrpc } from '../generators/grpc-generator.js';
import { createGateway, type GatewayOptions } from './gateway.js';
import type { IRSchema } from '../parsers/ir.js';
import { ChameleonError } from '../errors.js';

// ============================================================================
// Version
// ============================================================================

interface PackageJson {
  version?: string;
}

// Get package version
let version = '0.1.0';
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkgPath = resolve(__dirname, '../../package.json');
  if (existsSync(pkgPath)) {
    const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
    version = pkg.version ?? version;
  }
} catch {
  // Use default version
}

// ============================================================================
// CLI Setup
// ============================================================================

const program = new Command();

program
  .name('chameleon')
  .description('Schema-driven API protocol conversion gateway')
  .version(version);

// ============================================================================
// Start Command
// ============================================================================

program
  .command('start <schema>')
  .description('Start the Chameleon gateway with the specified schema')
  .option('-p, --port <port>', 'Server port', '4000')
  .option('-h, --host <host>', 'Server host', '0.0.0.0')
  .option('-b, --backend <url>', 'Backend base URL', 'http://localhost:3000')
  .option('--graphql-path <path>', 'GraphQL endpoint path', '/graphql')
  .option('--rest-path <path>', 'REST proxy base path', '/api')
  .option('--no-graphql', 'Disable GraphQL endpoint')
  .option('--no-rest', 'Disable REST proxy')
  .option('--no-logging', 'Disable request logging')
  .option('--cors-origin <origin>', 'CORS origin (use * for all)', '*')
  .action(async (schemaPath: string, opts: Record<string, unknown>) => {
    try {
      console.log('🦎 Chameleon Gateway');
      console.log('==================');
      console.log();

      // Resolve schema path
      const resolvedPath = resolve(process.cwd(), schemaPath);
      console.log(`📄 Loading schema: ${resolvedPath}`);

      if (!existsSync(resolvedPath)) {
        console.error(`❌ Schema file not found: ${resolvedPath}`);
        process.exit(1);
      }

      // Parse schema
      const schema = await parseSchema(resolvedPath);
      console.log(`✅ Schema loaded: ${schema.services.length} services, ${countMethods(schema)} methods`);

      // Build gateway options
      const gatewayOpts: GatewayOptions = {
        port: parseInt(opts.port as string, 10),
        host: opts.host as string,
        backendBaseUrl: opts.backend as string,
        enableGraphQL: opts.graphql !== false,
        graphqlPath: opts.graphqlPath as string,
        enableRestProxy: opts.rest !== false,
        restProxyPath: opts.restPath as string,
        enableLogging: opts.logging !== false,
        cors: {
          origin: opts.corsOrigin === '*' ? true : (opts.corsOrigin as string),
        },
      };

      // Create and start gateway
      console.log();
      console.log('🚀 Starting gateway...');
      const gateway = await createGateway(schema, gatewayOpts);
      await gateway.start();

      console.log();
      console.log('Gateway is running:');
      if (gatewayOpts.enableGraphQL) {
        console.log(`  GraphQL:     http://${gatewayOpts.host}:${gatewayOpts.port}${gatewayOpts.graphqlPath}`);
      }
      if (gatewayOpts.enableRestProxy) {
        console.log(`  REST Proxy:  http://${gatewayOpts.host}:${gatewayOpts.port}${gatewayOpts.restProxyPath}`);
      }
      console.log(`  Health:      http://${gatewayOpts.host}:${gatewayOpts.port}/health`);
      console.log(`  Schema:      http://${gatewayOpts.host}:${gatewayOpts.port}/_schema`);
      console.log();
      console.log('Press Ctrl+C to stop');

      // Handle shutdown - use void wrapper to avoid Promise type issues
      const shutdown = (): void => {
        console.log();
        console.log('🛑 Shutting down...');
        gateway.stop().then(
          () => process.exit(0),
          () => process.exit(1)
        );
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

    } catch (error) {
      handleError(error);
    }
  });

// ============================================================================
// Generate Command
// ============================================================================

program
  .command('generate <schema>')
  .description('Generate code from schema')
  .option('-o, --output <dir>', 'Output directory', './generated')
  .option('-t, --target <type>', 'Target type: graphql, typescript, rest, grpc, all', 'all')
  .option('--no-types', 'Skip TypeScript types generation')
  .action(async (schemaPath: string, opts: Record<string, unknown>) => {
    try {
      console.log('🦎 Chameleon Code Generator');
      console.log('==========================');
      console.log();

      // Resolve paths
      const resolvedPath = resolve(process.cwd(), schemaPath);
      const outputDir = resolve(process.cwd(), opts.output as string);

      console.log(`📄 Loading schema: ${resolvedPath}`);

      if (!existsSync(resolvedPath)) {
        console.error(`❌ Schema file not found: ${resolvedPath}`);
        process.exit(1);
      }

      // Parse schema
      const schema = await parseSchema(resolvedPath);
      console.log(`✅ Schema loaded: ${schema.services.length} services, ${countMethods(schema)} methods`);
      console.log();

      // Create output directory
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
        console.log(`📁 Created output directory: ${outputDir}`);
      }

      const target = opts.target as string;

      // Generate GraphQL
      if (target === 'all' || target === 'graphql') {
        console.log('🔧 Generating GraphQL schema...');
        const graphqlOutput = generateGraphQL(schema);
        writeFileSync(
          resolve(outputDir, 'schema.graphql'),
          graphqlOutput.typeDefs,
          'utf-8'
        );
        console.log(`   ✅ schema.graphql`);
      }

      // Generate TypeScript types
      if (opts.types !== false && (target === 'all' || target === 'typescript')) {
        console.log('🔧 Generating TypeScript types...');
        const tsOutput = generateTypeScript(schema);
        writeFileSync(
          resolve(outputDir, 'types.ts'),
          tsOutput.code,
          'utf-8'
        );
        console.log(`   ✅ types.ts`);
      }

      // Generate REST routes
      if (target === 'all' || target === 'rest') {
        console.log('🔧 Generating REST routes...');
        const restOutput = generateRestRoutes(schema);
        writeFileSync(
          resolve(outputDir, 'routes.json'),
          JSON.stringify(restOutput.routes.map(r => ({
            method: r.method,
            url: r.url,
            operationId: r.operationId,
            serviceName: r.serviceName,
            description: r.description,
            deprecated: r.deprecated,
          })), null, 2),
          'utf-8'
        );
        console.log(`   ✅ routes.json`);

        writeFileSync(
          resolve(outputDir, 'handlers.ts'),
          restOutput.handlerTypes,
          'utf-8'
        );
        console.log(`   ✅ handlers.ts`);
      }

      // Generate gRPC code
      if (target === 'all' || target === 'grpc') {
        console.log('🔧 Generating gRPC code...');
        const grpcOutput = generateGrpc(schema);
        writeFileSync(
          resolve(outputDir, 'service.proto'),
          grpcOutput.protoFile,
          'utf-8'
        );
        console.log(`   ✅ service.proto`);

        writeFileSync(
          resolve(outputDir, 'grpc-handlers.ts'),
          grpcOutput.handlerCode,
          'utf-8'
        );
        console.log(`   ✅ grpc-handlers.ts`);

        writeFileSync(
          resolve(outputDir, 'grpc-types.ts'),
          grpcOutput.typeDefinitions,
          'utf-8'
        );
        console.log(`   ✅ grpc-types.ts`);

        writeFileSync(
          resolve(outputDir, 'grpc-server.ts'),
          grpcOutput.serverCode,
          'utf-8'
        );
        console.log(`   ✅ grpc-server.ts`);

        if (grpcOutput.restTranslationCode) {
          writeFileSync(
            resolve(outputDir, 'rest-translation.ts'),
            grpcOutput.restTranslationCode,
            'utf-8'
          );
          console.log(`   ✅ rest-translation.ts`);
        }
      }

      console.log();
      console.log(`✨ Generation complete! Files written to: ${outputDir}`);

    } catch (error) {
      handleError(error);
    }
  });

// ============================================================================
// Validate Command
// ============================================================================

program
  .command('validate <schema>')
  .description('Validate a schema file')
  .action(async (schemaPath: string) => {
    try {
      console.log('🦎 Chameleon Schema Validator');
      console.log('============================');
      console.log();

      // Resolve path
      const resolvedPath = resolve(process.cwd(), schemaPath);
      console.log(`📄 Validating: ${resolvedPath}`);

      if (!existsSync(resolvedPath)) {
        console.error(`❌ Schema file not found: ${resolvedPath}`);
        process.exit(1);
      }

      // Parse schema
      const schema = await parseSchema(resolvedPath);

      console.log();
      console.log('✅ Schema is valid!');
      console.log();
      console.log('Summary:');
      console.log(`  Source type:   ${schema.sourceType}`);
      console.log(`  Version:       ${schema.sourceVersion ?? 'N/A'}`);
      console.log(`  Services:      ${schema.services.length}`);
      console.log(`  Methods:       ${countMethods(schema)}`);
      console.log();

      // List services
      console.log('Services:');
      for (const service of schema.services) {
        console.log(`  📦 ${service.name} (${service.methods.length} methods)`);
        for (const method of service.methods) {
          const deprecated = method.deprecated ? ' [deprecated]' : '';
          console.log(`     ${method.httpMethod ?? '???'} ${method.path ?? method.name}${deprecated}`);
        }
      }

    } catch (error) {
      handleError(error);
    }
  });

// ============================================================================
// Info Command
// ============================================================================

program
  .command('info <schema>')
  .description('Display detailed information about a schema')
  .action(async (schemaPath: string) => {
    try {
      const resolvedPath = resolve(process.cwd(), schemaPath);

      if (!existsSync(resolvedPath)) {
        console.error(`❌ Schema file not found: ${resolvedPath}`);
        process.exit(1);
      }

      const schema = await parseSchema(resolvedPath);

      const info = {
        sourceType: schema.sourceType,
        sourceVersion: schema.sourceVersion,
        title: schema.title,
        description: schema.description,
        version: schema.version,
        statistics: {
          services: schema.services.length,
          methods: countMethods(schema),
          queries: countQueries(schema),
          mutations: countMutations(schema),
        },
        services: schema.services.map((s) => ({
          name: s.name,
          description: s.description,
          methods: s.methods.map((m) => ({
            name: m.name,
            httpMethod: m.httpMethod,
            path: m.path,
            deprecated: m.deprecated,
          })),
        })),
      };

      console.log(JSON.stringify(info, null, 2));

    } catch (error) {
      handleError(error);
    }
  });

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse schema file based on extension
 */
async function parseSchema(filePath: string): Promise<IRSchema> {
  const ext = filePath.toLowerCase();

  if (ext.endsWith('.yaml') || ext.endsWith('.yml') || ext.endsWith('.json')) {
    return parseOpenAPIFile(filePath);
  }

  if (ext.endsWith('.proto')) {
    return parseProtobufFile(filePath);
  }

  if (ext.endsWith('.graphql') || ext.endsWith('.gql')) {
    const { parseGraphQLFile } = await import('../parsers/graphql.js');
    return parseGraphQLFile(filePath);
  }

  throw new Error(`Unsupported schema format: ${filePath}. Supported: .yaml, .yml, .json, .proto, .graphql, .gql`);
}

/**
 * Count total methods in schema
 */
function countMethods(schema: IRSchema): number {
  return schema.services.reduce((acc, s) => acc + s.methods.length, 0);
}

/**
 * Count query methods (GET)
 */
function countQueries(schema: IRSchema): number {
  return schema.services.reduce(
    (acc, s) =>
      acc + s.methods.filter((m) => m.httpMethod === 'GET' || m.httpMethod === 'HEAD').length,
    0
  );
}

/**
 * Count mutation methods (POST/PUT/PATCH/DELETE)
 */
function countMutations(schema: IRSchema): number {
  return schema.services.reduce(
    (acc, s) =>
      acc +
      s.methods.filter(
        (m) =>
          m.httpMethod === 'POST' ||
          m.httpMethod === 'PUT' ||
          m.httpMethod === 'PATCH' ||
          m.httpMethod === 'DELETE'
      ).length,
    0
  );
}

/**
 * Handle and display errors
 */
function handleError(error: unknown): never {
  console.error();

  if (error instanceof ChameleonError) {
    console.error(`❌ ${error.name}: ${error.message}`);
    if (error.cause) {
      console.error(`   Caused by: ${error.cause.message}`);
    }
  } else if (error instanceof Error) {
    console.error(`❌ Error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
  } else {
    const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
    console.error(`❌ Unknown error: ${errorStr}`);
  }

  process.exit(1);
}

// ============================================================================
// Run CLI
// ============================================================================

program.parse();
