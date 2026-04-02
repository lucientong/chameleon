# 🦎 Chameleon

A Schema-driven API protocol conversion gateway that seamlessly transforms APIs between REST, GraphQL, and gRPC — like a chameleon adapting to its environment.

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
npm install chameleon
```

## Quick Start

### Parse OpenAPI Schema

```typescript
import { parseOpenAPIFile } from 'chameleon';

// Parse an OpenAPI 3.x schema file
const irSchema = await parseOpenAPIFile('./petstore.yaml');

console.log('Services:', irSchema.services.map(s => s.name));
console.log('Methods:', irSchema.services.flatMap(s => s.methods.map(m => m.name)));
```

### Start the Gateway (Coming in Phase 3)

```typescript
import { ChameleonGateway } from 'chameleon';

const gateway = new ChameleonGateway({
  schema: './petstore.yaml',
  target: {
    rest: 'http://localhost:3000',
  },
  expose: {
    graphql: true,
    rest: true,
  },
});

await gateway.start(4000);
// REST backend now accessible via GraphQL at http://localhost:4000/graphql
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

### Phase 2: GraphQL Generator 🚧

- [ ] IR → GraphQL SDL generation
- [ ] IR → GraphQL resolvers generation
- [ ] TypeScript type definitions for client usage

### Phase 3: Runtime Translator + Gateway

- [ ] Request/response format translation
- [ ] IR-based runtime parameter validation (Zod)
- [ ] Fastify gateway server
- [ ] CLI entry point

### Phase 4: Protobuf Parser + gRPC Support

- [ ] Protobuf (.proto) file parser
- [ ] gRPC service generator
- [ ] gRPC ↔ REST bidirectional translation

### Phase 5: DataLoader + Stream Bridge

- [ ] Automatic DataLoader injection for N+1 optimization
- [ ] gRPC Stream ↔ WebSocket/SSE bridge
- [ ] GraphQL Subscription support

### Phase 6: Hot Reload + Admin Panel

- [ ] Schema file watching (chokidar)
- [ ] Worker Thread async compilation
- [ ] Seamless runtime route switching
- [ ] Admin API for monitoring

## API Reference

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

### Parser Functions

```typescript
// Parse from file
const schema = await parseOpenAPIFile('./api.yaml');

// Parse from object
const schema = await parseOpenAPIDocument(openApiObject);

// With options
const schema = await parseOpenAPIFile('./api.yaml', {
  defaultServiceName: 'API',
  includeDeprecated: false,
});
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

Apache License 2.0 - see [LICENSE](./LICENSE) for details.
