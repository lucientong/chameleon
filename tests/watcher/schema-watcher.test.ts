/**
 * Tests for the Schema Watcher
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  SchemaWatcher,
  createSchemaWatcher,
  detectSchemaFormat,
} from '../../src/watcher/schema-watcher.js';

// ============================================================================
// detectSchemaFormat
// ============================================================================

describe('detectSchemaFormat', () => {
  it('should detect OpenAPI YAML format', () => {
    expect(detectSchemaFormat('api.yaml')).toBe('openapi');
    expect(detectSchemaFormat('api.yml')).toBe('openapi');
    expect(detectSchemaFormat('/path/to/api.YAML')).toBe('openapi');
  });

  it('should detect OpenAPI JSON format', () => {
    expect(detectSchemaFormat('api.json')).toBe('openapi');
    expect(detectSchemaFormat('/path/to/swagger.json')).toBe('openapi');
  });

  it('should detect Protobuf format', () => {
    expect(detectSchemaFormat('service.proto')).toBe('protobuf');
    expect(detectSchemaFormat('/path/to/api.proto')).toBe('protobuf');
  });

  it('should detect GraphQL format', () => {
    expect(detectSchemaFormat('schema.graphql')).toBe('graphql');
    expect(detectSchemaFormat('schema.gql')).toBe('graphql');
  });

  it('should return unknown for unsupported formats', () => {
    expect(detectSchemaFormat('file.txt')).toBe('unknown');
    expect(detectSchemaFormat('file.ts')).toBe('unknown');
    expect(detectSchemaFormat('file.js')).toBe('unknown');
    expect(detectSchemaFormat('noextension')).toBe('unknown');
  });
});

// ============================================================================
// SchemaWatcher - Construction
// ============================================================================

describe('SchemaWatcher', () => {
  let watcher: SchemaWatcher | null = null;

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }
  });

  describe('construction', () => {
    it('should create with default options', () => {
      watcher = new SchemaWatcher();
      expect(watcher.isWatching()).toBe(false);
    });

    it('should create with custom options', () => {
      watcher = new SchemaWatcher({
        debounceMs: 500,
        usePolling: true,
      });
      expect(watcher.isWatching()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      watcher = new SchemaWatcher();
      const stats = watcher.getStats();

      expect(stats.totalChanges).toBe(0);
      expect(stats.triggeredChanges).toBe(0);
      expect(stats.watchedFiles).toBe(0);
      expect(stats.startedAt).toBeNull();
      expect(stats.isWatching).toBe(false);
    });
  });

  describe('start/stop', () => {
    it('should throw if started twice', () => {
      watcher = new SchemaWatcher();
      watcher.start('/tmp');

      expect(() => watcher!.start('/tmp')).toThrow(
        'Watcher is already running'
      );
    });

    it('should be safe to stop when not started', async () => {
      watcher = new SchemaWatcher();
      await watcher.stop(); // Should not throw
    });

    it('should update stats on start', () => {
      watcher = new SchemaWatcher();
      watcher.start('/tmp');

      const stats = watcher.getStats();
      expect(stats.isWatching).toBe(true);
      expect(stats.startedAt).not.toBeNull();
    });

    it('should accept string or array paths', () => {
      watcher = new SchemaWatcher();
      watcher.start(['/tmp/a', '/tmp/b']);

      expect(watcher.isWatching()).toBe(true);
    });
  });

  describe('event handlers', () => {
    it('should register change handler', () => {
      watcher = new SchemaWatcher();
      const handler = (): void => {
        /* noop */
      };

      // Should not throw
      watcher.onChange(handler);
      watcher.offChange(handler);
    });

    it('should register error handler', () => {
      watcher = new SchemaWatcher();
      watcher.onError(() => {
        /* noop */
      });
    });

    it('should register ready handler', () => {
      watcher = new SchemaWatcher();
      watcher.onReady(() => {
        /* noop */
      });
    });
  });
});

// ============================================================================
// Convenience Functions
// ============================================================================

describe('createSchemaWatcher', () => {
  it('should create a watcher instance', () => {
    const watcher = createSchemaWatcher();
    expect(watcher).toBeInstanceOf(SchemaWatcher);
    expect(watcher.isWatching()).toBe(false);
  });

  it('should pass options through', () => {
    const watcher = createSchemaWatcher({ debounceMs: 1000 });
    expect(watcher).toBeInstanceOf(SchemaWatcher);
  });
});
