# gRPC-to-REST Example

This example demonstrates how to use Chameleon to parse a `.proto` file and generate REST-compatible code from gRPC service definitions.

## Overview

Chameleon reads a Protocol Buffers (`.proto`) file, converts it into the universal Intermediate Representation (IR), and then generates:

- **`.proto` file** — regenerated proto definition from IR
- **Handler scaffolding** — TypeScript handler stubs for each gRPC method
- **TypeScript types** — interfaces for request/response messages
- **Server bootstrap** — gRPC server setup code using `@grpc/grpc-js`
- **REST translation** — Fastify routes that proxy REST calls to gRPC services

## Source Proto

The example uses a simple Greeter service defined in [`greeter.proto`](./greeter.proto):

```protobuf
service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc SayHelloStream (HelloRequest) returns (stream HelloReply);
}
```

## Usage

### 1. Parse Proto File

```typescript
import { parseProtobufFile } from 'chameleon';

const schema = await parseProtobufFile('./greeter.proto');
console.log(`Parsed ${schema.services.length} services`);
```

### 2. Generate gRPC Code

```typescript
import { generateGrpc } from 'chameleon';

const output = generateGrpc(schema, {
  packageName: 'greeter',
  serverPort: 50051,
});

// Write generated files
import { writeFileSync } from 'fs';

writeFileSync('generated/greeter.proto', output.protoFile);
writeFileSync('generated/handlers.ts', output.handlerCode);
writeFileSync('generated/types.ts', output.typeDefinitions);
writeFileSync('generated/server.ts', output.serverCode);

if (output.restTranslationCode) {
  writeFileSync('generated/rest-translation.ts', output.restTranslationCode);
}
```

### 3. Using the CLI

You can also use the Chameleon CLI to parse and validate `.proto` files:

```bash
# Validate a proto file
npx chameleon validate greeter.proto

# Generate code from a proto file
npx chameleon generate greeter.proto --output ./generated --target all
```

### 4. Start Gateway with Proto

```bash
# Start the gateway with a proto file
npx chameleon start greeter.proto --port 4000 --backend http://localhost:50051
```

## REST Mapping Conventions

Chameleon automatically infers REST endpoints from gRPC method names:

| gRPC Method Pattern | HTTP Method | REST Path |
| --- | --- | --- |
| `Get{Resource}` | `GET` | `/{resources}/:id` |
| `List{Resources}` | `GET` | `/{resources}` |
| `Create{Resource}` | `POST` | `/{resources}` |
| `Update{Resource}` | `PUT` | `/{resources}/:id` |
| `Delete{Resource}` | `DELETE` | `/{resources}/:id` |
| Other | `POST` | `/{service}/{method}` |

## Streaming Methods

Streaming gRPC methods are **not** mapped to REST endpoints by default, since HTTP/1.1 does not natively support bidirectional streaming. However, they are still available through:

- **Server-side streaming** → Server-Sent Events (SSE) *(Phase 5)*
- **Client-side streaming** → Chunked HTTP POST *(Phase 5)*
- **Bidirectional streaming** → WebSocket *(Phase 5)*

## Generated Service Info

The generator also produces runtime service metadata:

```typescript
const { serviceInfo } = output;

for (const service of serviceInfo) {
  console.log(`Service: ${service.fullServiceName}`);
  for (const method of service.methods) {
    const streaming = method.clientStreaming || method.serverStreaming
      ? ' (streaming)'
      : '';
    console.log(`  ${method.name}${streaming}`);
  }
}
```

## gRPC Status Code Mapping

The REST translation layer automatically maps gRPC status codes to HTTP status codes:

| gRPC Code | HTTP Status |
| --- | --- |
| `OK` (0) | 200 |
| `INVALID_ARGUMENT` (3) | 400 |
| `NOT_FOUND` (5) | 404 |
| `ALREADY_EXISTS` (6) | 409 |
| `PERMISSION_DENIED` (7) | 403 |
| `UNAUTHENTICATED` (16) | 401 |
| `INTERNAL` (13) | 500 |
| `UNAVAILABLE` (14) | 503 |

## Related

- [Petstore REST-to-GraphQL Example](../petstore-rest-to-graphql/) — Convert OpenAPI to GraphQL
- [Chameleon README](../../README.md) — Project overview and full documentation
