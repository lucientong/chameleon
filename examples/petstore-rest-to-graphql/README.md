# Petstore REST to GraphQL Example

This example demonstrates how to use Chameleon to automatically expose a REST API as a GraphQL endpoint.

## Overview

The Petstore API is defined using OpenAPI 3.0 specification. Chameleon parses this specification and automatically generates:

- GraphQL SDL schema
- GraphQL resolvers that translate queries/mutations to REST API calls
- TypeScript type definitions

## Prerequisites

- Node.js 20+
- A running REST backend (or use the built-in mock handler)

## Quick Start

### 1. Start the Gateway (with mock backend)

```bash
# From the project root
npm run build

# Start with mock backend
npm start -- start ../petstore/petstore.yaml --port 4000
```

### 2. Start the Gateway (with real backend)

```bash
# Point to your actual REST API backend
npm start -- start ../petstore/petstore.yaml \
  --port 4000 \
  --backend-url http://localhost:3000
```

### 3. Access the GraphQL Playground

Open `http://localhost:4000/graphql` in your browser.

## Example Queries

### List all pets

```graphql
query {
  listPets(limit: 10) {
    items {
      id
      name
      status
      category {
        id
        name
      }
    }
    total
  }
}
```

### Get a specific pet

```graphql
query {
  getPetById(petId: 1) {
    id
    name
    status
    photoUrls
    tags {
      id
      name
    }
  }
}
```

### Create a new pet

```graphql
mutation {
  createPet(input: {
    name: "Fluffy"
    status: available
    category: {
      id: 1
      name: "Dogs"
    }
  }) {
    id
    name
    status
  }
}
```

### Update a pet

```graphql
mutation {
  updatePet(petId: 1, input: {
    name: "Fluffy Jr."
    status: sold
  }) {
    id
    name
    status
  }
}
```

### Delete a pet

```graphql
mutation {
  deletePet(petId: 1)
}
```

## REST to GraphQL Mapping

| REST Endpoint | HTTP Method | GraphQL Operation |
|--------------|-------------|-------------------|
| `/pets` | GET | `Query.listPets` |
| `/pets` | POST | `Mutation.createPet` |
| `/pets/{petId}` | GET | `Query.getPetById` |
| `/pets/{petId}` | PUT | `Mutation.updatePet` |
| `/pets/{petId}` | DELETE | `Mutation.deletePet` |
| `/store/inventory` | GET | `Query.getInventory` |
| `/users` | POST | `Mutation.createUser` |
| `/users/{username}` | GET | `Query.getUserByUsername` |

## Generated GraphQL Schema

You can view the generated GraphQL SDL at `http://localhost:4000/_graphql/sdl`.

Example output:

```graphql
type Query {
  listPets(limit: Int, offset: Int, status: PetStatus): PetList
  getPetById(petId: Int!): Pet
  getInventory: JSON
  getUserByUsername(username: String!): User
}

type Mutation {
  createPet(input: CreatePetRequestInput!): Pet
  updatePet(petId: Int!, input: UpdatePetRequestInput!): Pet
  deletePet(petId: Int!): Boolean
  createUser(input: CreateUserRequestInput!): User
}

type Pet {
  id: Int!
  name: String!
  category: Category
  photoUrls: [String]
  tags: [Tag]
  status: PetStatus!
  createdAt: String
  updatedAt: String
}

enum PetStatus {
  available
  pending
  sold
}

# ... more types
```

## API Endpoints

The gateway exposes several useful endpoints:

| Endpoint | Description |
|----------|-------------|
| `/graphql` | GraphQL endpoint (GET/POST) |
| `/api/*` | REST proxy endpoints |
| `/health` | Health check endpoint |
| `/_schema` | IR schema introspection |
| `/_graphql/sdl` | Generated GraphQL SDL |

## Programmatic Usage

```typescript
import { OpenAPIParser } from 'chameleon-gateway';
import { createGateway } from 'chameleon-gateway';

// Parse the OpenAPI schema
const schema = await OpenAPIParser.parseFile('./petstore.yaml');

// Create and start the gateway
const gateway = await createGateway(schema, {
  port: 4000,
  backendBaseUrl: 'http://localhost:3000',
  enableGraphQL: true,
  enableRestProxy: true,
});

await gateway.start();
console.log('Gateway started at http://localhost:4000');
```

## Configuration Options

```typescript
interface GatewayOptions {
  port?: number;              // Server port (default: 4000)
  host?: string;              // Server host (default: '0.0.0.0')
  backendBaseUrl?: string;    // REST backend URL
  enableGraphQL?: boolean;    // Enable GraphQL endpoint (default: true)
  graphqlPath?: string;       // GraphQL path (default: '/graphql')
  enableRestProxy?: boolean;  // Enable REST proxy (default: true)
  restProxyPath?: string;     // REST proxy base path (default: '/api')
  enableLogging?: boolean;    // Enable request logging (default: true)
  cors?: {                    // CORS configuration
    origin?: string | string[] | boolean;
    methods?: string[];
    credentials?: boolean;
  };
  healthCheckPath?: string;   // Health check path (default: '/health')
}
```

## Related

- [gRPC → REST Example](../grpc-to-rest/) — Parse .proto and generate REST-compatible code
- [Chameleon README](../../README.md) — Project overview and full API documentation
