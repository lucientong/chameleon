# 🦎 Chameleon

一个 Schema 驱动的 API 协议自动转换网关，像变色龙一样让 API 在 REST、GraphQL 和 gRPC 之间无缝切换。

[![npm version](https://img.shields.io/npm/v/chameleon-gateway.svg)](https://www.npmjs.com/package/chameleon-gateway)
[![npm downloads](https://img.shields.io/npm/dm/chameleon-gateway.svg)](https://www.npmjs.com/package/chameleon-gateway)
[![Node.js Version](https://img.shields.io/node/v/chameleon-gateway.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![License](https://img.shields.io/npm/l/chameleon-gateway.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub](https://img.shields.io/badge/GitHub-lucientong%2Fchameleon-181717.svg?logo=github)](https://github.com/lucientong/chameleon)

[English](./README.md)

## 特性

- 🔄 **协议转换**：在 REST、GraphQL 和 gRPC 之间无缝转换
- 📝 **Schema 驱动**：解析 OpenAPI、Protobuf 和 GraphQL SDL 规范
- 🚀 **运行时翻译**：实时请求/响应格式转换
- 🔥 **热更新**：无需重启即可更新 Schema
- 📊 **管理面板**：监控路由、Schema 和转换统计
- ⚡ **DataLoader 集成**：自动优化 N+1 查询问题

## 安装

```bash
npm install chameleon-gateway
```

或从源码安装：

```bash
git clone https://github.com/lucientong/chameleon.git
cd chameleon
npm install
npm run build
npm link  # 可选：使 `chameleon` CLI 全局可用
```

## 快速开始

### 解析 OpenAPI Schema

```typescript
import { parseOpenAPIFile } from 'chameleon-gateway';

// 解析 OpenAPI 3.x Schema 文件
const irSchema = await parseOpenAPIFile('./petstore.yaml');

console.log('服务:', irSchema.services.map(s => s.name));
console.log('方法:', irSchema.services.flatMap(s => s.methods.map(m => m.name)));
```

### 生成代码

```typescript
import { generateGraphQL, generateTypeScript, generateGrpc } from 'chameleon-gateway';

// 生成 GraphQL schema 和 resolvers
const graphql = generateGraphQL(irSchema);
console.log(graphql.typeDefs); // GraphQL SDL

// 生成 TypeScript 类型定义
const ts = generateTypeScript(irSchema);
console.log(ts.code); // TypeScript 接口

// 从 Protobuf 生成 gRPC 代码
import { parseProtobufFile } from 'chameleon-gateway';
const protoSchema = await parseProtobufFile('./greeter.proto');
const grpc = generateGrpc(protoSchema);
```

### 启动网关

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
// REST 后端现在可以通过 GraphQL 访问：http://localhost:4000/graphql
// REST 代理：http://localhost:4000/api/*
```

### 使用 CLI

```bash
# 验证 Schema 文件
npx chameleon-gateway validate ./petstore.yaml

# 生成代码（GraphQL、TypeScript、REST、gRPC）
npx chameleon-gateway generate ./petstore.yaml --output ./generated

# 启动网关
npx chameleon-gateway start ./petstore.yaml --port 4000 --backend http://localhost:3000
```

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                          Chameleon                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │ OpenAPI  │    │ Protobuf │    │ GraphQL  │   输入 Schema    │
│  │  解析器  │    │  解析器  │    │  解析器  │                  │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘                  │
│       │               │               │                         │
│       └───────────────┼───────────────┘                         │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │       IR       │  统一中间表示                   │
│              │    (统一)      │                                 │
│              └────────┬───────┘                                 │
│                       │                                         │
│       ┌───────────────┼───────────────┐                         │
│       ▼               ▼               ▼                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │   REST   │    │ GraphQL  │    │   gRPC   │   代码生成器     │
│  │  生成器  │    │  生成器  │    │  生成器  │                  │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘                  │
│       │               │               │                         │
│       └───────────────┼───────────────┘                         │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │    运行时      │  请求/响应翻译                  │
│              │    翻译器      │                                 │
│              └────────┬───────┘                                 │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │     网关       │  基于 Fastify 的 HTTP 服务      │
│              │   (Fastify)    │                                 │
│              └────────────────┘                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 开发路线图

### Phase 1: IR 定义 + OpenAPI 解析器 ✅

- [x] 项目骨架搭建（TypeScript、ESM、Vitest）
- [x] 中间表示（IR）类型定义
- [x] OpenAPI 3.x 解析器（支持 $ref 解引用）
- [x] Petstore 示例和单元测试

### Phase 2: GraphQL 生成器 ✅

- [x] IR → GraphQL SDL 生成
- [x] IR → GraphQL resolvers 生成
- [x] 客户端 TypeScript 类型定义

### Phase 3: 运行时翻译器 + 网关 ✅

- [x] 请求/响应格式翻译
- [x] 基于 IR 的运行时参数校验（Zod）
- [x] Fastify 网关服务器
- [x] CLI 入口

### Phase 4: Protobuf 解析器 + gRPC 支持 ✅

- [x] Protobuf（.proto）文件解析器
- [x] gRPC 服务生成器
- [x] gRPC ↔ REST 双向翻译

### Phase 5: DataLoader + Stream 桥接 ✅

- [x] 自动 DataLoader 注入解决 N+1 问题
- [x] gRPC Stream ↔ WebSocket/SSE 桥接
- [x] GraphQL Subscription 支持

### Phase 6: 热更新 + 管理面板 ✅

- [x] Schema 文件监听（chokidar）
- [x] Worker Thread 异步编译
- [x] 无缝运行时路由切换
- [x] 监控管理 API

## API 参考

### 解析器

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

### 代码生成器

```typescript
// GraphQL 生成
import { generateGraphQL, generateGraphQLTypeDefs } from 'chameleon-gateway';

const { typeDefs, resolvers, operationMap } = generateGraphQL(schema);

// TypeScript 类型生成
import { generateTypeScript, generateTypeScriptCode } from 'chameleon-gateway';

const { code, typeCount } = generateTypeScript(schema);

// REST 路由生成
import { generateRestRoutes, generateRouteConfigs } from 'chameleon-gateway';

const { routes, handlerTypes } = generateRestRoutes(schema);

// gRPC 代码生成
import { generateGrpc, generateProtoFile } from 'chameleon-gateway';

const { protoFile, handlerCode, typeDefinitions, serverCode, restTranslationCode, serviceInfo } =
  generateGrpc(schema, { packageName: 'myservice', serverPort: 50051 });
```

### 网关

```typescript
import { createGateway, chameleonPlugin } from 'chameleon-gateway';

// 创建独立网关
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

// 或作为 Fastify 插件使用
import Fastify from 'fastify';
const app = Fastify();
await app.register(chameleonPlugin, { schema, backendBaseUrl: 'http://localhost:3000' });
```

### 运行时

```typescript
// 请求/响应翻译
import { createTranslator } from 'chameleon-gateway';

const translator = createTranslator(schema, { backendHandler });

// 参数校验（基于 Zod）
import { createValidator, validateType, assertValid } from 'chameleon-gateway';

const validator = createValidator(schema);
const result = validator.validate('Pet', data);
assertValid('Pet', data, schema); // 无效时抛出异常

// DataLoader 解决 N+1 问题
import { createDataLoaderManager, detectBatchableEndpoints, analyzeN1Patterns } from 'chameleon-gateway';

const manager = createDataLoaderManager(schema, { maxBatchSize: 100 });
const batchable = detectBatchableEndpoints(schema);
const patterns = analyzeN1Patterns(schema);

// Stream 桥接（gRPC Stream ↔ WebSocket/SSE）
import { createStreamBridgeManager, createSSEAdapter, createWebSocketAdapter } from 'chameleon-gateway';

const bridgeManager = createStreamBridgeManager({ maxConnections: 1000 });
const sseAdapter = createSSEAdapter(streamSource, { heartbeatInterval: 30000 });
const wsAdapter = createWebSocketAdapter(streamSource, streamSink);
```

### 热更新与管理

```typescript
// Schema 文件监听
import { createSchemaWatcher, detectSchemaFormat } from 'chameleon-gateway';

const watcher = createSchemaWatcher({
  paths: ['./schemas'],
  extensions: ['.yaml', '.proto', '.graphql'],
  debounceMs: 500,
});
watcher.on('change', (event) => console.log('Schema 已变更:', event));
await watcher.start();

// Worker Thread 热更新
import { createHotReloadManager } from 'chameleon-gateway';

const reloader = createHotReloadManager({
  watchPaths: ['./schemas'],
  onReload: (newSchema) => gateway.updateSchema(newSchema),
});
await reloader.start();

// 管理 API（Fastify 插件）
import { registerAdminAPI } from 'chameleon-gateway';

await registerAdminAPI(app, {
  schema,
  prefix: '/_admin',
  enableMetrics: true,
});
// 端点: /_admin/schemas, /_admin/routes, /_admin/stats, /_admin/health
```

### IR 类型

```typescript
// 核心类型
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

// 类型系统（可辨识联合）
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

## 示例

- [Petstore REST → GraphQL](./examples/petstore-rest-to-graphql/) — 将 OpenAPI 转换为 GraphQL 网关
- [gRPC → REST](./examples/grpc-to-rest/) — 解析 .proto 文件并生成 REST 兼容代码
- [Petstore OpenAPI 规范](./examples/petstore/) — 示例 OpenAPI 3.0 规范文件

## 贡献

欢迎贡献代码！请随时提交 Pull Request。

## 许可证

Apache License 2.0 — 详见 [LICENSE](./LICENSE)
