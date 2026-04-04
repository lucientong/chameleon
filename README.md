# 🦎 Chameleon

A Schema-driven API protocol conversion gateway that seamlessly transforms APIs between REST, GraphQL, and gRPC — like a chameleon adapting to its environment.

[![npm version](https://img.shields.io/npm/v/chameleon-gateway.svg)](https://www.npmjs.com/package/chameleon-gateway)
[![npm downloads](https://img.shields.io/npm/dm/chameleon-gateway.svg)](https://www.npmjs.com/package/chameleon-gateway)
[![Node.js Version](https://img.shields.io/node/v/chameleon-gateway.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![License](https://img.shields.io/npm/l/chameleon-gateway.svg)](https://opensource.org/licenses/Apache-2.0)

[中文文档](./README.zh-CN.md)

## Features

- 🔄 **Protocol Conversion**: Seamlessly convert between REST, GraphQL, and gRPC
- 📝 **Schema-Driven**: Parse OpenAPI, Protobuf, and GraphQL SDL schemas
- 🚀 **Runtime Translation**: Real-time request/response translation
- 🔥 **Hot Reload**: Update schemas without restarting the gateway
- 📊 **Admin Panel**: Monitor routes, schemas, and conversion statistics
- ⚡ **DataLoader Integration**: Automatic N+1 query optimization

## Installation

```bash
npm install chameleon-gateway
```

Or install from source:

```bash
git clone https://github.com/lucientong/chameleon.git
cd chameleon
npm install
npm run build
npm link  # optional: makes `chameleon` CLI available globally
```

## Quick Start

### Parse OpenAPI Schema

```typescript
import { parseOpenAPIFile } from 'chameleon-gateway';

// Parse an OpenAPI 3.x schema file
const irSchema = await parseOpenAPIFile('./petstore.yaml');

console.log('Services:', irSchema.services.map(s => s.name));
console.log('Methods:', irSchema.services.flatMap(s => s.methods.map(m => m.name)));
```

### Generate Code from Schema

```typescript
import { generateGraphQL, generateTypeScript, generateGrpc } from 'chameleon-gateway';

// Generate GraphQL schema and resolvers
const graphql = generateGraphQL(irSchema);
console.log(graphql.typeDefs); // GraphQL SDL

// Generate TypeScript type definitions
const ts = generateTypeScript(irSchema);
console.log(ts.code); // TypeScript interfaces

// Generate gRPC code from protobuf
import { parseProtobufFile } from 'chameleon-gateway';
const protoSchema = await parseProtobufFile('./greeter.proto');
const grpc = generateGrpc(protoSchema);
```

### Start the Gateway

```typescript
import { parseOpenAPIFile, createGateway } from 'chameleon-gateway';

const schema = await parseOpenAPIFile('./petstore.yaml');

const gateway = await createGateway(schema, {
  port: 4000,
  backendBaseUrl: 'http://localhost:3000',
  enableGraphQL: true,
  enableRestProxy: true,
});

await gateway.start();
// REST backend now accessible via GraphQL at http://localhost:4000/graphql
// REST proxy at http://localhost:4000/api/*
```

### Use the CLI

```bash
# Validate a schema file
npx chameleon-gateway validate ./petstore.yaml

# Generate code (GraphQL, TypeScript, REST, gRPC)
npx chameleon-gateway generate ./petstore.yaml --output ./generated

# Start the gateway
npx chameleon-gateway start ./petstore.yaml --port 4000 --backend http://localhost:3000
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Chameleon                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │ OpenAPI  │    │ Protobuf │    │ GraphQL  │   Input Schemas  │
│  │  Parser  │    │  Parser  │    │  Parser  │                  │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘                  │
│       │               │               │                         │
│       └───────────────┼───────────────┘                         │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │       IR       │  Intermediate Representation    │
│              │   (Unified)    │                                 │
│              └────────┬───────┘                                 │
│                       │                                         │
│       ┌───────────────┼───────────────┐                         │
│       ▼               ▼               ▼                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │   REST   │    │ GraphQL  │    │   gRPC   │   Generators     │
│  │Generator │    │Generator │    │Generator │                  │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘                  │
│       │               │               │                         │
│       └───────────────┼───────────────┘                         │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │    Runtime     │  Request/Response Translation   │
│              │   Translator   │                                 │
│              └────────┬───────┘                                 │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │    Gateway     │  Fastify-based HTTP Server      │
│              │    (Fastify)   │                                 │
│              └────────────────┘                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Development Roadmap

### Phase 1: IR Definition + OpenAPI Parser ✅

- [x] Project scaffolding (TypeScript, ESM, Vitest)
- [x] Intermediate Representation (IR) type definitions
- [x] OpenAPI 3.x parser with $ref dereferencing
- [x] Petstore example and unit tests

### Phase 2: GraphQL Generator ✅

- [x] IR → GraphQL SDL generation
- [x] IR → GraphQL resolvers generation
- [x] TypeScript type definitions for client usage

### Phase 3: Runtime Translator + Gateway ✅

- [x] Request/response format translation
- [x] IR-based runtime parameter validation (Zod)
- [x] Fastify gateway server
- [x] CLI entry point

### Phase 4: Protobuf Parser + gRPC Support ✅

- [x] Protobuf (.proto) file parser
- [x] gRPC service generator
- [x] gRPC ↔ REST bidirectional translation

### Phase 5: DataLoader + Stream Bridge ✅

- [x] Automatic DataLoader injection for N+1 optimization
- [x] gRPC Stream ↔ WebSocket/SSE bridge
- [x] GraphQL Subscription support

### Phase 6: Hot Reload + Admin Panel ✅

- [x] Schema file watching (chokidar)
- [x] Worker Thread async compilation
- [x] Seamless runtime route switching
- [x] Admin API for monitoring

## API Reference

### Parsers

```typescript
// OpenAPI 3.x
import { parseOpenAPIFile, parseOpenAPIDocument, OpenAPIParser } from 'chameleon-gateway';

const schema = await parseOpenAPIFile('./api.yaml');
const schema = await parseOpenAPIDocument(openApiObject);
const schema = await parseOpenAPIFile('./api.yaml', {
  defaultServiceName: 'API',
  includeDeprecated: false,
});

// Protobuf (.proto)
import { parseProtobufFile, parseProtobufString, ProtobufParser } from 'chameleon-gateway';

const schema = await parseProtobufFile('./service.proto');
const schema = await parseProtobufString(protoContent, { packageName: 'myservice' });

// GraphQL SDL
import { parseGraphQLFile, parseGraphQLString, GraphQLSDLParser } from 'chameleon-gateway';

const schema = await parseGraphQLFile('./schema.graphql');
const schema = await parseGraphQLString(sdlContent);
```

### Generators

```typescript
// GraphQL generation
import { generateGraphQL, generateGraphQLTypeDefs } from 'chameleon-gateway';

const { typeDefs, resolvers, operationMap } = generateGraphQL(schema);

// TypeScript type generation
import { generateTypeScript, generateTypeScriptCode } from 'chameleon-gateway';

const { code, typeCount } = generateTypeScript(schema);

// REST route generation
import { generateRestRoutes, generateRouteConfigs } from 'chameleon-gateway';

const { routes, handlerTypes } = generateRestRoutes(schema);

// gRPC code generation
import { generateGrpc, generateProtoFile } from 'chameleon-gateway';

const { protoFile, handlerCode, typeDefinitions, serverCode, restTranslationCode, serviceInfo } =
  generateGrpc(schema, { packageName: 'myservice', serverPort: 50051 });
```

### Gateway

```typescript
import { createGateway, chameleonPlugin } from 'chameleon-gateway';

// Create a standalone gateway
const gateway = await createGateway(schema, {
  port: 4000,
  host: '0.0.0.0',
  backendBaseUrl: 'http://localhost:3000',
  enableGraphQL: true,
  graphqlPath: '/graphql',
  enableRestProxy: true,
  restProxyPath: '/api',
  enableLogging: true,
  cors: { origin: true },
});
await gateway.start();

// Or use as a Fastify plugin
import Fastify from 'fastify';
const app = Fastify();
await app.register(chameleonPlugin, { schema, backendBaseUrl: 'http://localhost:3000' });
```

### Runtime

```typescript
// Request/Response translation
import { createTranslator } from 'chameleon-gateway';

const translator = createTranslator(schema, { backendHandler });

// Parameter validation (Zod-based)
import { createValidator, validateType, assertValid } from 'chameleon-gateway';

const validator = createValidator(schema);
const result = validator.validate('Pet', data);
assertValid('Pet', data, schema); // throws on invalid

// DataLoader for N+1 optimization
import { createDataLoaderManager, detectBatchableEndpoints, analyzeN1Patterns } from 'chameleon-gateway';

const manager = createDataLoaderManager(schema, { maxBatchSize: 100 });
const batchable = detectBatchableEndpoints(schema);
const patterns = analyzeN1Patterns(schema);

// Stream Bridge (gRPC Stream ↔ WebSocket/SSE)
import { createStreamBridgeManager, createSSEAdapter, createWebSocketAdapter } from 'chameleon-gateway';

const bridgeManager = createStreamBridgeManager({ maxConnections: 1000 });
const sseAdapter = createSSEAdapter(streamSource, { heartbeatInterval: 30000 });
const wsAdapter = createWebSocketAdapter(streamSource, streamSink);
```

### Hot Reload & Admin

```typescript
// Schema file watching
import { createSchemaWatcher, detectSchemaFormat } from 'chameleon-gateway';

const watcher = createSchemaWatcher({
  paths: ['./schemas'],
  extensions: ['.yaml', '.proto', '.graphql'],
  debounceMs: 500,
});
watcher.on('change', (event) => console.log('Schema changed:', event));
await watcher.start();

// Hot reload with Worker Threads
import { createHotReloadManager } from 'chameleon-gateway';

const reloader = createHotReloadManager({
  watchPaths: ['./schemas'],
  onReload: (newSchema) => gateway.updateSchema(newSchema),
});
await reloader.start();

// Admin API (Fastify plugin)
import { registerAdminAPI } from 'chameleon-gateway';

await registerAdminAPI(app, {
  schema,
  prefix: '/_admin',
  enableMetrics: true,
});
// Endpoints: /_admin/schemas, /_admin/routes, /_admin/stats, /_admin/health
```

### IR Types

```typescript
// Core types
interface IRSchema {
  services: IRService[];
  types?: Map<string, IRType>;
  sourceType: 'openapi' | 'protobuf' | 'graphql';
  // ...
}

interface IRService {
  name: string;
  methods: IRMethod[];
  // ...
}

interface IRMethod {
  name: string;
  httpMethod?: HttpMethod;
  path?: string;
  input: IRType;
  output: IRType;
  // ...
}

// Type system (discriminated union)
type IRType =
  | { kind: 'primitive'; primitiveType: PrimitiveType }
  | { kind: 'object'; fields: IRField[] }
  | { kind: 'array'; elementType: IRType }
  | { kind: 'enum'; values: (string | number)[] }
  | { kind: 'union'; variants: IRType[] }
  | { kind: 'ref'; refName: string }
  | { kind: 'any' }
  | { kind: 'void' };
```

## Examples

- [Petstore REST → GraphQL](./examples/petstore-rest-to-graphql/) — Convert OpenAPI to GraphQL gateway
- [gRPC → REST](./examples/grpc-to-rest/) — Parse .proto and generate REST-compatible code
- [Petstore OpenAPI Schema](./examples/petstore/) — Sample OpenAPI 3.0 specification

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

Apache License 2.0 — see [LICENSE](./LICENSE) for details.
