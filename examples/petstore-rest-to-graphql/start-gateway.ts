/**
 * Petstore REST to GraphQL Gateway Starter
 *
 * This script demonstrates how to programmatically start a Chameleon gateway
 * that exposes the Petstore REST API as GraphQL.
 */
/* eslint-disable no-console */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAPIParser } from '../../src/parsers/openapi.js';
import { createGateway } from '../../src/server/gateway.js';
import type { TranslationContext, TranslationResult } from '../../src/runtime/translator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock backend handler for demonstration
// In production, you would point to your actual REST API backend
async function mockBackendHandler(ctx: TranslationContext): Promise<TranslationResult> {
  // Await to satisfy @typescript-eslint/require-await
  await Promise.resolve();
  const httpMethod = ctx.method.httpMethod ?? 'GET';
  const urlPath = ctx.method.path ?? '/';

  // Replace path parameters with actual values
  const resolvedPath = urlPath.replace(/:(\w+)/g, (_, param: string) => {
    return String(ctx.pathParams[param] ?? '');
  }).replace(/\{(\w+)\}/g, (_, param: string) => {
    return String(ctx.pathParams[param] ?? '');
  });

  // Mock data
  const pets = [
    {
      id: 1,
      name: 'Buddy',
      status: 'available',
      category: { id: 1, name: 'Dogs' },
      photoUrls: ['https://example.com/buddy.jpg'],
      tags: [{ id: 1, name: 'friendly' }],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-15T12:00:00Z',
    },
    {
      id: 2,
      name: 'Whiskers',
      status: 'pending',
      category: { id: 2, name: 'Cats' },
      photoUrls: ['https://example.com/whiskers.jpg'],
      tags: [{ id: 2, name: 'playful' }],
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-16T12:00:00Z',
    },
    {
      id: 3,
      name: 'Goldie',
      status: 'available',
      category: { id: 3, name: 'Fish' },
      photoUrls: [],
      tags: [],
      createdAt: '2024-01-03T00:00:00Z',
      updatedAt: '2024-01-03T00:00:00Z',
    },
  ];

  const users = [
    {
      id: 1,
      username: 'john_doe',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '+1-555-0100',
      userStatus: 1,
    },
  ];

  // Route handling
  if (resolvedPath === '/pets' && httpMethod === 'GET') {
    const limit = parseInt(String(ctx.queryParams['limit'] ?? '20'));
    const offset = parseInt(String(ctx.queryParams['offset'] ?? '0'));
    const status = ctx.queryParams['status'] as string | undefined;

    let filteredPets = pets;
    if (status) {
      filteredPets = pets.filter((p) => p.status === status);
    }

    const items = filteredPets.slice(offset, offset + limit);
    return {
      statusCode: 200,
      body: {
        items,
        total: filteredPets.length,
        limit,
        offset,
      },
    };
  }

  if (resolvedPath === '/pets' && httpMethod === 'POST') {
    const body = ctx.body as Record<string, unknown>;
    const newPet = {
      id: pets.length + 1,
      name: body['name'] as string,
      status: (body['status'] as string) ?? 'available',
      category: body['category'] ?? null,
      photoUrls: body['photoUrls'] ?? [],
      tags: body['tags'] ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return { statusCode: 201, body: newPet };
  }

  const petMatch = resolvedPath.match(/^\/pets\/(\d+)$/);
  if (petMatch) {
    const petId = parseInt(petMatch[1] ?? '0');
    const pet = pets.find((p) => p.id === petId);

    if (httpMethod === 'GET') {
      if (pet) {
        return { statusCode: 200, body: pet };
      }
      return { statusCode: 404, body: { code: 404, message: 'Pet not found' } };
    }

    if (httpMethod === 'PUT') {
      if (pet) {
        const body = ctx.body as Record<string, unknown>;
        const updatedPet = {
          ...pet,
          ...body,
          id: petId,
          updatedAt: new Date().toISOString(),
        };
        return { statusCode: 200, body: updatedPet };
      }
      return { statusCode: 404, body: { code: 404, message: 'Pet not found' } };
    }

    if (httpMethod === 'DELETE') {
      if (pet) {
        return { statusCode: 204, body: null };
      }
      return { statusCode: 404, body: { code: 404, message: 'Pet not found' } };
    }
  }

  if (resolvedPath === '/store/inventory' && httpMethod === 'GET') {
    return {
      statusCode: 200,
      body: {
        available: pets.filter((p) => p.status === 'available').length,
        pending: pets.filter((p) => p.status === 'pending').length,
        sold: pets.filter((p) => p.status === 'sold').length,
      },
    };
  }

  if (resolvedPath === '/users' && httpMethod === 'POST') {
    const body = ctx.body as Record<string, unknown>;
    const newUser = {
      id: users.length + 1,
      username: body['username'] as string,
      firstName: body['firstName'] ?? null,
      lastName: body['lastName'] ?? null,
      email: body['email'] as string,
      phone: body['phone'] ?? null,
      userStatus: 1,
    };
    return { statusCode: 201, body: newUser };
  }

  const userMatch = resolvedPath.match(/^\/users\/([^/]+)$/);
  if (userMatch && httpMethod === 'GET') {
    const username = userMatch[1];
    const user = users.find((u) => u.username === username);
    if (user) {
      return { statusCode: 200, body: user };
    }
    return { statusCode: 404, body: { code: 404, message: 'User not found' } };
  }

  return { statusCode: 404, body: { code: 404, message: 'Not found' } };
}

async function main(): Promise<void> {
  console.log('🦎 Starting Petstore REST to GraphQL Gateway...\n');

  // Parse the Petstore OpenAPI schema
  const schemaPath = path.join(__dirname, '../petstore/petstore.yaml');
  console.log(`📄 Loading schema from: ${schemaPath}`);

  const schema = await OpenAPIParser.parseFile(schemaPath);
  console.log(`✅ Parsed ${schema.services.length} services with ${schema.services.reduce((acc, s) => acc + s.methods.length, 0)} methods\n`);

  // Create the gateway
  const gateway = await createGateway(schema, {
    port: 4000,
    host: 'localhost',
    enableGraphQL: true,
    enableRestProxy: true,
    enableLogging: false, // Set to true for verbose logging
    translatorOptions: {
      backendHandler: mockBackendHandler,
    },
  });

  // Start the gateway
  await gateway.start();

  console.log('\n🚀 Gateway started successfully!\n');
  console.log('📍 Endpoints:');
  console.log('   • GraphQL:    http://localhost:4000/graphql');
  console.log('   • REST Proxy: http://localhost:4000/api/*');
  console.log('   • Health:     http://localhost:4000/health');
  console.log('   • Schema:     http://localhost:4000/_schema');
  console.log('   • SDL:        http://localhost:4000/_graphql/sdl');
  console.log('\n📝 Example GraphQL queries:');
  console.log(`
  # List pets
  query {
    listPets(limit: 10) {
      items { id name status }
      total
    }
  }

  # Get pet by ID
  query {
    getPetById(petId: 1) {
      id name status category { name }
    }
  }

  # Create pet
  mutation {
    createPet(input: { name: "Rex", status: available }) {
      id name status
    }
  }
`);
  console.log('Press Ctrl+C to stop the gateway.\n');

  // Handle graceful shutdown
  const shutdown = (): void => {
    console.log('\n\n👋 Shutting down gateway...');
    gateway.stop().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('Failed to start gateway:', error);
  process.exit(1);
});
