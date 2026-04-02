# 🦎 Chameleon

一个 Schema 驱动的 API 协议自动转换网关，像变色龙一样让 API 在 REST、GraphQL 和 gRPC 之间无缝切换。

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
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
npm install chameleon
```

## 快速开始

### 解析 OpenAPI Schema

```typescript
import { parseOpenAPIFile } from 'chameleon';

// 解析 OpenAPI 3.x Schema 文件
const irSchema = await parseOpenAPIFile('./petstore.yaml');

console.log('服务:', irSchema.services.map(s => s.name));
console.log('方法:', irSchema.services.flatMap(s => s.methods.map(m => m.name)));
```

### 启动网关（Phase 3 实现）

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
// REST 后端现在可以通过 GraphQL 访问：http://localhost:4000/graphql
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

### Phase 2: GraphQL 生成器 🚧

- [ ] IR → GraphQL SDL 生成
- [ ] IR → GraphQL resolvers 生成
- [ ] 客户端 TypeScript 类型定义

### Phase 3: 运行时翻译器 + 网关

- [ ] 请求/响应格式翻译
- [ ] 基于 IR 的运行时参数校验（Zod）
- [ ] Fastify 网关服务器
- [ ] CLI 入口

### Phase 4: Protobuf 解析器 + gRPC 支持

- [ ] Protobuf（.proto）文件解析器
- [ ] gRPC 服务生成器
- [ ] gRPC ↔ REST 双向翻译

### Phase 5: DataLoader + Stream 桥接

- [ ] 自动 DataLoader 注入解决 N+1 问题
- [ ] gRPC Stream ↔ WebSocket/SSE 桥接
- [ ] GraphQL Subscription 支持

### Phase 6: 热更新 + 管理面板

- [ ] Schema 文件监听（chokidar）
- [ ] Worker Thread 异步编译
- [ ] 无缝运行时路由切换
- [ ] 监控管理 API

## API 参考

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

### 解析函数

```typescript
// 从文件解析
const schema = await parseOpenAPIFile('./api.yaml');

// 从对象解析
const schema = await parseOpenAPIDocument(openApiObject);

// 带选项
const schema = await parseOpenAPIFile('./api.yaml', {
  defaultServiceName: 'API',
  includeDeprecated: false,
});
```

## 贡献

欢迎贡献代码！请随时提交 Pull Request。

## 许可证

MIT 许可证 - 详见 [LICENSE](./LICENSE)
