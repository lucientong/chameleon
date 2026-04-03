/**
 * Schema Watcher
 *
 * Watches schema files for changes using chokidar and triggers
 * recompilation events. Supports debouncing to avoid rapid-fire
 * rebuilds during editor saves.
 */

import { watch, type FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import { resolve, extname } from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Schema file change event type
 */
export type SchemaChangeType = 'add' | 'change' | 'unlink';

/**
 * Event emitted when a schema file changes
 */
export interface SchemaChangeEvent {
  /** Type of change */
  type: SchemaChangeType;
  /** Absolute path of the changed file */
  filePath: string;
  /** Detected schema format */
  format: SchemaFormat;
  /** Timestamp of the event */
  timestamp: number;
}

/**
 * Supported schema file formats
 */
export type SchemaFormat = 'openapi' | 'protobuf' | 'graphql' | 'unknown';

/**
 * Options for the schema watcher
 */
export interface SchemaWatcherOptions {
  /** Debounce interval in milliseconds */
  debounceMs?: number;
  /** File patterns to watch (glob) */
  patterns?: string[];
  /** Whether to watch for file additions */
  watchAdd?: boolean;
  /** Whether to watch for file deletions */
  watchUnlink?: boolean;
  /** Ignored paths/patterns */
  ignored?: string[];
  /** Use polling instead of native events (for network filesystems) */
  usePolling?: boolean;
  /** Polling interval in ms (only used with usePolling) */
  pollInterval?: number;
}

/**
 * Schema watcher statistics
 */
export interface SchemaWatcherStats {
  /** Total change events detected */
  totalChanges: number;
  /** Changes that triggered recompilation (after debounce) */
  triggeredChanges: number;
  /** Currently watched file count */
  watchedFiles: number;
  /** Watcher start time */
  startedAt: number | null;
  /** Whether the watcher is active */
  isWatching: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<SchemaWatcherOptions> = {
  debounceMs: 300,
  patterns: [
    '**/*.yaml',
    '**/*.yml',
    '**/*.json',
    '**/*.proto',
    '**/*.graphql',
    '**/*.gql',
  ],
  watchAdd: true,
  watchUnlink: true,
  ignored: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/coverage/**',
  ],
  usePolling: false,
  pollInterval: 1000,
};

/**
 * File extension to schema format mapping
 */
const EXTENSION_FORMAT_MAP: Record<string, SchemaFormat> = {
  '.yaml': 'openapi',
  '.yml': 'openapi',
  '.json': 'openapi',
  '.proto': 'protobuf',
  '.graphql': 'graphql',
  '.gql': 'graphql',
};

// ============================================================================
// Schema Watcher Class
// ============================================================================

/**
 * Watches schema files for changes and emits debounced change events
 */
export class SchemaWatcher {
  private watcher: FSWatcher | null = null;
  private emitter = new EventEmitter();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private options: Required<SchemaWatcherOptions>;
  private stats: SchemaWatcherStats = {
    totalChanges: 0,
    triggeredChanges: 0,
    watchedFiles: 0,
    startedAt: null,
    isWatching: false,
  };
  private watchedPaths: Set<string> = new Set();

  constructor(options?: SchemaWatcherOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start watching the given paths
   */
  start(paths: string | string[]): void {
    if (this.watcher) {
      throw new Error('Watcher is already running. Call stop() first.');
    }

    const watchPaths = Array.isArray(paths) ? paths : [paths];

    this.watcher = watch(watchPaths, {
      ignored: this.options.ignored,
      persistent: true,
      ignoreInitial: true,
      usePolling: this.options.usePolling,
      interval: this.options.pollInterval,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    // Register event handlers
    this.watcher.on('change', (filePath: string) => {
      this.handleFileEvent('change', filePath);
    });

    if (this.options.watchAdd) {
      this.watcher.on('add', (filePath: string) => {
        this.watchedPaths.add(filePath);
        this.stats.watchedFiles = this.watchedPaths.size;
        this.handleFileEvent('add', filePath);
      });
    }

    if (this.options.watchUnlink) {
      this.watcher.on('unlink', (filePath: string) => {
        this.watchedPaths.delete(filePath);
        this.stats.watchedFiles = this.watchedPaths.size;
        this.handleFileEvent('unlink', filePath);
      });
    }

    this.watcher.on('error', (error: Error) => {
      this.emitter.emit('error', error);
    });

    // Track ready state
    this.watcher.on('ready', () => {
      this.emitter.emit('ready');
    });

    this.stats.startedAt = Date.now();
    this.stats.isWatching = true;
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (!this.watcher) {
      return;
    }

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    await this.watcher.close();
    this.watcher = null;
    this.stats.isWatching = false;
    this.watchedPaths.clear();
    this.stats.watchedFiles = 0;
  }

  /**
   * Subscribe to schema change events (after debounce)
   */
  onChange(handler: (event: SchemaChangeEvent) => void): void {
    this.emitter.on('change', handler);
  }

  /**
   * Subscribe to error events
   */
  onError(handler: (error: Error) => void): void {
    this.emitter.on('error', handler);
  }

  /**
   * Subscribe to ready event (initial scan complete)
   */
  onReady(handler: () => void): void {
    this.emitter.on('ready', handler);
  }

  /**
   * Remove a change event listener
   */
  offChange(handler: (event: SchemaChangeEvent) => void): void {
    this.emitter.off('change', handler);
  }

  /**
   * Get watcher statistics
   */
  getStats(): SchemaWatcherStats {
    return { ...this.stats };
  }

  /**
   * Get all currently watched file paths
   */
  getWatchedPaths(): string[] {
    return [...this.watchedPaths];
  }

  /**
   * Check if the watcher is actively watching
   */
  isWatching(): boolean {
    return this.stats.isWatching;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Handle a raw file event with debouncing
   */
  private handleFileEvent(
    type: SchemaChangeType,
    filePath: string
  ): void {
    const format = detectSchemaFormat(filePath);
    if (format === 'unknown') {
      return; // Ignore non-schema files
    }

    this.stats.totalChanges++;

    const absolutePath = resolve(filePath);

    // Clear existing debounce timer for this file
    const existingTimer = this.debounceTimers.get(absolutePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(absolutePath);
      this.stats.triggeredChanges++;

      const event: SchemaChangeEvent = {
        type,
        filePath: absolutePath,
        format,
        timestamp: Date.now(),
      };

      this.emitter.emit('change', event);
    }, this.options.debounceMs);

    this.debounceTimers.set(absolutePath, timer);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Detect schema format from file extension
 */
export function detectSchemaFormat(filePath: string): SchemaFormat {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_FORMAT_MAP[ext] ?? 'unknown';
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a schema watcher with default options
 */
export function createSchemaWatcher(
  options?: SchemaWatcherOptions
): SchemaWatcher {
  return new SchemaWatcher(options);
}
