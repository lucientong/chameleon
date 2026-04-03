/**
 * Tests for the Hot Reload Manager
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  HotReloadManager,
  createHotReloadManager,
  type HotReloadEvent,
  type HotReloadError,
  type ReloadState,
} from '../../src/watcher/hot-reload.js';
import type { IRSchema } from '../../src/parsers/ir.js';
import {
  createSchema,
  createService,
  createMethod,
  createPrimitiveType,
} from '../../src/parsers/ir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, '../fixtures');

// ============================================================================
// Test Helpers
// ============================================================================

function createMockSchema(name: string = 'Mock'): IRSchema {
  return createSchema(
    [
      createService(name, [
        createMethod(
          'testMethod',
          createPrimitiveType('string'),
          createPrimitiveType('string'),
          { httpMethod: 'GET', path: '/test' }
        ),
      ]),
    ],
    'openapi'
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('HotReloadManager', () => {
  let manager: HotReloadManager;

  afterEach(async () => {
    await manager.stop();
  });

  describe('construction', () => {
    it('should create with default options', () => {
      manager = new HotReloadManager();
      expect(manager.getState()).toBe('idle');
      expect(manager.getActiveSchema()).toBeNull();
    });

    it('should create with custom options', () => {
      manager = new HotReloadManager({
        compilationTimeoutMs: 10000,
        keepOldOnError: false,
      });
      expect(manager.getState()).toBe('idle');
    });
  });

  describe('start/stop', () => {
    it('should start with initial schema', () => {
      const initialSchema = createMockSchema('Initial');
      manager = new HotReloadManager();
      manager.start('/tmp', initialSchema);

      expect(manager.getActiveSchema()).toBe(initialSchema);
    });

    it('should start without initial schema', () => {
      manager = new HotReloadManager();
      manager.start('/tmp');

      expect(manager.getActiveSchema()).toBeNull();
    });

    it('should clean up on stop', async () => {
      manager = new HotReloadManager();
      manager.start('/tmp');
      await manager.stop();

      expect(manager.getState()).toBe('idle');
    });
  });

  describe('manual reload', () => {
    it('should reload from an OpenAPI file', async () => {
      const filePath = resolve(FIXTURES_DIR, 'petstore.yaml');
      manager = new HotReloadManager();

      const schema = await manager.reload(filePath, 'openapi');

      expect(schema).toBeDefined();
      expect(schema.sourceType).toBe('openapi');
      expect(schema.services.length).toBeGreaterThan(0);
      expect(manager.getActiveSchema()).toBe(schema);
    });

    it('should reload with custom parser', async () => {
      const mockSchema = createMockSchema('Custom');
      manager = new HotReloadManager({
        customParser: async () => mockSchema,
      });

      const schema = await manager.reload('/fake/path.yaml', 'openapi');

      expect(schema).toBe(mockSchema);
      expect(manager.getActiveSchema()).toBe(mockSchema);
    });

    it('should update stats on successful reload', async () => {
      const mockSchema = createMockSchema();
      manager = new HotReloadManager({
        customParser: async () => mockSchema,
      });

      await manager.reload('/fake/path.yaml', 'openapi');
      const stats = manager.getStats();

      expect(stats.successfulReloads).toBe(1);
      expect(stats.failedReloads).toBe(0);
      expect(stats.totalReloads).toBe(1);
      expect(stats.lastReloadAt).not.toBeNull();
      expect(stats.history).toHaveLength(1);
      expect(stats.history[0]!.success).toBe(true);
    });

    it('should update stats on failed reload', async () => {
      manager = new HotReloadManager({
        customParser: async () => {
          throw new Error('Parse failed');
        },
      });

      await expect(
        manager.reload('/fake/path.yaml', 'openapi')
      ).rejects.toThrow('Parse failed');

      const stats = manager.getStats();
      expect(stats.successfulReloads).toBe(0);
      expect(stats.failedReloads).toBe(1);
      expect(stats.totalReloads).toBe(1);
      expect(stats.history[0]!.success).toBe(false);
      expect(stats.history[0]!.errorMessage).toBe('Parse failed');
    });

    it('should handle unsupported format', async () => {
      manager = new HotReloadManager();

      await expect(
        manager.reload('/fake/path.txt', 'unknown' as 'openapi')
      ).rejects.toThrow('Unsupported schema format');
    });
  });

  describe('events', () => {
    it('should emit reload event on success', async () => {
      const mockSchema = createMockSchema();
      manager = new HotReloadManager({
        customParser: async () => mockSchema,
      });

      const events: HotReloadEvent[] = [];
      manager.onReload((event) => events.push(event));

      await manager.reload('/fake/path.yaml', 'openapi');

      expect(events).toHaveLength(1);
      expect(events[0]!.newSchema).toBe(mockSchema);
      expect(events[0]!.previousSchema).toBeNull();
      expect(events[0]!.compilationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should emit error event on failure', async () => {
      manager = new HotReloadManager({
        customParser: async () => {
          throw new Error('Test error');
        },
      });

      const errors: HotReloadError[] = [];
      manager.onError((error) => errors.push(error));

      try {
        await manager.reload('/fake/path.yaml', 'openapi');
      } catch {
        // Expected
      }

      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.message).toBe('Test error');
    });

    it('should emit state change events', async () => {
      const mockSchema = createMockSchema();
      manager = new HotReloadManager({
        customParser: async () => mockSchema,
      });

      const states: ReloadState[] = [];
      manager.onStateChange((state) => states.push(state));

      await manager.reload('/fake/path.yaml', 'openapi');

      // compiling → swapping → completed → idle
      expect(states).toContain('compiling');
      expect(states).toContain('swapping');
      expect(states).toContain('completed');
      expect(states).toContain('idle');
    });

    it('should track previous schema on subsequent reloads', async () => {
      const schema1 = createMockSchema('First');
      const schema2 = createMockSchema('Second');
      let callCount = 0;

      manager = new HotReloadManager({
        customParser: async () => {
          callCount++;
          return callCount === 1 ? schema1 : schema2;
        },
      });

      const events: HotReloadEvent[] = [];
      manager.onReload((event) => events.push(event));

      await manager.reload('/fake/path.yaml', 'openapi');
      await manager.reload('/fake/path.yaml', 'openapi');

      expect(events).toHaveLength(2);
      expect(events[0]!.previousSchema).toBeNull();
      expect(events[0]!.newSchema).toBe(schema1);
      expect(events[1]!.previousSchema).toBe(schema1);
      expect(events[1]!.newSchema).toBe(schema2);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', async () => {
      const mockSchema = createMockSchema();
      manager = new HotReloadManager({
        customParser: async () => mockSchema,
      });

      await manager.reload('/fake/path.yaml', 'openapi');

      const stats = manager.getStats();

      expect(stats.state).toBe('idle');
      expect(stats.successfulReloads).toBe(1);
      expect(stats.failedReloads).toBe(0);
      expect(stats.totalReloads).toBe(1);
      expect(stats.averageCompilationTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.activeSchemaSourceType).toBe('openapi');
      expect(stats.activeSchemaServiceCount).toBe(1);
      expect(stats.activeSchemaMethodCount).toBe(1);
    });

    it('should calculate average compilation time', async () => {
      let delay = 0;
      manager = new HotReloadManager({
        customParser: async () => {
          if (delay > 0) {
            await new Promise((r) => setTimeout(r, delay));
          }
          return createMockSchema();
        },
      });

      await manager.reload('/path.yaml', 'openapi');
      delay = 10;
      await manager.reload('/path.yaml', 'openapi');

      const stats = manager.getStats();
      expect(stats.averageCompilationTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.totalReloads).toBe(2);
    });
  });

  describe('history', () => {
    it('should maintain history of reloads', async () => {
      const mockSchema = createMockSchema();
      manager = new HotReloadManager({
        customParser: async () => mockSchema,
        maxHistorySize: 5,
      });

      await manager.reload('/path1.yaml', 'openapi');
      await manager.reload('/path2.yaml', 'openapi');

      const stats = manager.getStats();
      expect(stats.history).toHaveLength(2);
      expect(stats.history[0]!.triggerFile).toBe('/path1.yaml');
      expect(stats.history[1]!.triggerFile).toBe('/path2.yaml');
    });

    it('should trim history when exceeding max size', async () => {
      const mockSchema = createMockSchema();
      manager = new HotReloadManager({
        customParser: async () => mockSchema,
        maxHistorySize: 3,
      });

      for (let i = 0; i < 5; i++) {
        await manager.reload(`/path${i}.yaml`, 'openapi');
      }

      const stats = manager.getStats();
      expect(stats.history).toHaveLength(3);
      // Most recent entries should be kept
      expect(stats.history[0]!.triggerFile).toBe('/path2.yaml');
      expect(stats.history[2]!.triggerFile).toBe('/path4.yaml');
    });
  });

  describe('timeout', () => {
    it('should timeout long compilations', async () => {
      manager = new HotReloadManager({
        compilationTimeoutMs: 50,
        customParser: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return createMockSchema();
        },
      });

      await expect(
        manager.reload('/path.yaml', 'openapi')
      ).rejects.toThrow('timed out');
    });
  });

  describe('getWatcher', () => {
    it('should return the underlying schema watcher', () => {
      manager = new HotReloadManager();
      const watcher = manager.getWatcher();

      expect(watcher).toBeDefined();
      expect(typeof watcher.start).toBe('function');
      expect(typeof watcher.stop).toBe('function');
    });
  });

  describe('protobuf reload', () => {
    it('should reload from a protobuf file', async () => {
      const filePath = resolve(FIXTURES_DIR, 'greeter.proto');
      manager = new HotReloadManager();

      const schema = await manager.reload(filePath, 'protobuf');

      expect(schema).toBeDefined();
      expect(schema.sourceType).toBe('protobuf');
    });
  });

  describe('graphql reload', () => {
    it('should reload from a graphql file', async () => {
      const filePath = resolve(FIXTURES_DIR, 'schema.graphql');
      manager = new HotReloadManager();

      const schema = await manager.reload(filePath, 'graphql');

      expect(schema).toBeDefined();
      expect(schema.sourceType).toBe('graphql');
      expect(schema.services.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Convenience Functions
// ============================================================================

describe('createHotReloadManager', () => {
  it('should create a manager instance', async () => {
    const manager = createHotReloadManager();
    expect(manager).toBeInstanceOf(HotReloadManager);
    expect(manager.getState()).toBe('idle');
    await manager.stop();
  });
});
