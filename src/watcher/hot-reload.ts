/**
 * Hot Reload Manager
 *
 * Provides zero-downtime schema reloading using a double-buffering
 * strategy. New schemas are compiled asynchronously while the current
 * schema continues serving traffic. Once compilation succeeds, an
 * atomic swap replaces the active schema.
 *
 * Architecture:
 *   SchemaWatcher → HotReloadManager → atomic swap → Gateway
 *
 * The "double buffer" approach keeps two schema slots:
 *   - active: currently serving traffic
 *   - pending: being compiled from a newly detected file change
 *
 * When compilation finishes, pending becomes active atomically.
 */

import { EventEmitter } from 'events';
import type { IRSchema } from '../parsers/ir.js';
import { parseOpenAPIFile } from './openapi-compat.js';
import {
  SchemaWatcher,
  type SchemaChangeEvent,
  type SchemaWatcherOptions,
  type SchemaFormat,
} from './schema-watcher.js';
import { ChameleonError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Hot reload configuration options
 */
export interface HotReloadOptions {
  /** Schema watcher options */
  watcherOptions?: SchemaWatcherOptions;
  /** Maximum compilation time before timeout (ms) */
  compilationTimeoutMs?: number;
  /** Whether to keep serving old schema on compilation error */
  keepOldOnError?: boolean;
  /** Maximum number of reload history entries to keep */
  maxHistorySize?: number;
  /** Custom parser function override */
  customParser?: (filePath: string, format: SchemaFormat) => Promise<IRSchema>;
}

/**
 * State of a hot reload operation
 */
export type ReloadState =
  | 'idle'
  | 'compiling'
  | 'swapping'
  | 'completed'
  | 'failed';

/**
 * Hot reload event emitted after a schema swap
 */
export interface HotReloadEvent {
  /** Previous schema (null on first load) */
  previousSchema: IRSchema | null;
  /** New active schema */
  newSchema: IRSchema;
  /** File that triggered the reload */
  triggerFile: string;
  /** Time spent compiling (ms) */
  compilationTimeMs: number;
  /** Timestamp of the swap */
  timestamp: number;
}

/**
 * Hot reload error event
 */
export interface HotReloadError {
  /** Error that occurred */
  error: Error;
  /** File that triggered the failed reload */
  triggerFile: string;
  /** Time before failure (ms) */
  elapsedMs: number;
  /** Timestamp of the failure */
  timestamp: number;
}

/**
 * Snapshot of a past reload operation
 */
export interface ReloadHistoryEntry {
  /** File that triggered the reload */
  triggerFile: string;
  /** Schema format */
  format: SchemaFormat;
  /** Whether the reload succeeded */
  success: boolean;
  /** Compilation time (ms) */
  compilationTimeMs: number;
  /** Timestamp */
  timestamp: number;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Hot reload manager statistics
 */
export interface HotReloadStats {
  /** Current state */
  state: ReloadState;
  /** Number of successful reloads */
  successfulReloads: number;
  /** Number of failed reloads */
  failedReloads: number;
  /** Total reloads attempted */
  totalReloads: number;
  /** Average compilation time (ms) */
  averageCompilationTimeMs: number;
  /** Last reload timestamp */
  lastReloadAt: number | null;
  /** Current active schema source type */
  activeSchemaSourceType: string | null;
  /** Number of services in active schema */
  activeSchemaServiceCount: number;
  /** Number of methods in active schema */
  activeSchemaMethodCount: number;
  /** Reload history */
  history: ReloadHistoryEntry[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<Omit<HotReloadOptions, 'customParser'>> & {
  customParser: HotReloadOptions['customParser'];
} = {
  watcherOptions: {},
  compilationTimeoutMs: 30_000,
  keepOldOnError: true,
  maxHistorySize: 50,
  customParser: undefined,
};

// ============================================================================
// Hot Reload Manager
// ============================================================================

/**
 * Manages schema hot reloading with double-buffering and atomic swap
 */
export class HotReloadManager {
  private emitter = new EventEmitter();
  private watcher: SchemaWatcher;
  private options: typeof DEFAULT_OPTIONS;

  // Double buffer
  private activeSchema: IRSchema | null = null;
  private pendingCompilation: AbortController | null = null;

  // State tracking
  private state: ReloadState = 'idle';
  private stats = {
    successfulReloads: 0,
    failedReloads: 0,
    totalCompilationTimeMs: 0,
  };
  private history: ReloadHistoryEntry[] = [];

  constructor(options?: HotReloadOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      watcherOptions: {
        ...DEFAULT_OPTIONS.watcherOptions,
        ...options?.watcherOptions,
      },
    };

    this.watcher = new SchemaWatcher(this.options.watcherOptions);
    this.watcher.onChange((event) => {
      void this.handleSchemaChange(event);
    });
    this.watcher.onError((error) => {
      this.emitter.emit('error', error);
    });
  }

  /**
   * Start watching and hot reloading
   *
   * @param paths - File paths or directories to watch
   * @param initialSchema - Optional initial schema to use before any reload
   */
  start(paths: string | string[], initialSchema?: IRSchema): void {
    if (initialSchema) {
      this.activeSchema = initialSchema;
    }
    this.watcher.start(paths);
  }

  /**
   * Stop watching and clean up
   */
  async stop(): Promise<void> {
    // Cancel any pending compilation
    if (this.pendingCompilation) {
      this.pendingCompilation.abort();
      this.pendingCompilation = null;
    }

    await this.watcher.stop();
    this.state = 'idle';
  }

  /**
   * Get the currently active schema
   */
  getActiveSchema(): IRSchema | null {
    return this.activeSchema;
  }

  /**
   * Manually trigger a reload from a file
   */
  async reload(filePath: string, format: SchemaFormat): Promise<IRSchema> {
    const event: SchemaChangeEvent = {
      type: 'change',
      filePath,
      format,
      timestamp: Date.now(),
    };
    return this.compileAndSwap(event);
  }

  /**
   * Subscribe to successful reload events
   */
  onReload(handler: (event: HotReloadEvent) => void): void {
    this.emitter.on('reload', handler);
  }

  /**
   * Subscribe to reload error events
   */
  onError(handler: (error: HotReloadError) => void): void {
    this.emitter.on('reloadError', handler);
  }

  /**
   * Subscribe to watcher-level error events
   */
  onWatchError(handler: (error: Error) => void): void {
    this.emitter.on('error', handler);
  }

  /**
   * Subscribe to state change events
   */
  onStateChange(handler: (state: ReloadState) => void): void {
    this.emitter.on('stateChange', handler);
  }

  /**
   * Get current state
   */
  getState(): ReloadState {
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): HotReloadStats {
    const totalReloads =
      this.stats.successfulReloads + this.stats.failedReloads;
    const avgTime =
      totalReloads > 0
        ? this.stats.totalCompilationTimeMs / totalReloads
        : 0;

    let methodCount = 0;
    if (this.activeSchema) {
      for (const svc of this.activeSchema.services) {
        methodCount += svc.methods.length;
      }
    }

    return {
      state: this.state,
      successfulReloads: this.stats.successfulReloads,
      failedReloads: this.stats.failedReloads,
      totalReloads,
      averageCompilationTimeMs: Math.round(avgTime),
      lastReloadAt:
        this.history.length > 0
          ? this.history[this.history.length - 1]!.timestamp
          : null,
      activeSchemaSourceType: this.activeSchema?.sourceType ?? null,
      activeSchemaServiceCount: this.activeSchema?.services.length ?? 0,
      activeSchemaMethodCount: methodCount,
      history: [...this.history],
    };
  }

  /**
   * Get the underlying schema watcher
   */
  getWatcher(): SchemaWatcher {
    return this.watcher;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Handle a schema change event from the watcher
   */
  private async handleSchemaChange(
    event: SchemaChangeEvent
  ): Promise<void> {
    // Skip unlink events - we don't reload when files are deleted
    if (event.type === 'unlink') {
      return;
    }

    try {
      await this.compileAndSwap(event);
    } catch {
      // Errors are already emitted in compileAndSwap
    }
  }

  /**
   * Compile a new schema and atomically swap it in
   */
  private async compileAndSwap(
    event: SchemaChangeEvent
  ): Promise<IRSchema> {
    // Cancel any pending compilation
    if (this.pendingCompilation) {
      this.pendingCompilation.abort();
    }

    const abortController = new AbortController();
    this.pendingCompilation = abortController;

    this.setState('compiling');
    const startTime = Date.now();

    try {
      // Compile with timeout
      const newSchema = await Promise.race([
        this.compileSchema(event.filePath, event.format),
        this.createTimeout(
          this.options.compilationTimeoutMs,
          abortController.signal
        ),
      ]);

      // Check if aborted
      if (abortController.signal.aborted) {
        throw new ChameleonError(
          'Compilation was cancelled by a newer change',
          'HOT_RELOAD_CANCELLED'
        );
      }

      const compilationTimeMs = Date.now() - startTime;

      // Atomic swap
      this.setState('swapping');
      const previousSchema = this.activeSchema;
      this.activeSchema = newSchema;
      this.pendingCompilation = null;

      // Update stats
      this.stats.successfulReloads++;
      this.stats.totalCompilationTimeMs += compilationTimeMs;

      // Record history
      this.addHistoryEntry({
        triggerFile: event.filePath,
        format: event.format,
        success: true,
        compilationTimeMs,
        timestamp: Date.now(),
      });

      this.setState('completed');

      // Emit reload event
      const reloadEvent: HotReloadEvent = {
        previousSchema,
        newSchema,
        triggerFile: event.filePath,
        compilationTimeMs,
        timestamp: Date.now(),
      };
      this.emitter.emit('reload', reloadEvent);

      // Reset to idle after successful swap
      this.setState('idle');

      return newSchema;
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      this.pendingCompilation = null;
      this.stats.failedReloads++;
      this.stats.totalCompilationTimeMs += elapsedMs;

      const err =
        error instanceof Error
          ? error
          : new Error(String(error));

      // Record history
      this.addHistoryEntry({
        triggerFile: event.filePath,
        format: event.format,
        success: false,
        compilationTimeMs: elapsedMs,
        timestamp: Date.now(),
        errorMessage: err.message,
      });

      this.setState('failed');

      // Emit error
      const reloadError: HotReloadError = {
        error: err,
        triggerFile: event.filePath,
        elapsedMs,
        timestamp: Date.now(),
      };
      this.emitter.emit('reloadError', reloadError);

      // Reset to idle
      this.setState('idle');

      throw err;
    }
  }

  /**
   * Compile a schema file to IR
   */
  private async compileSchema(
    filePath: string,
    format: SchemaFormat
  ): Promise<IRSchema> {
    // Use custom parser if provided
    if (this.options.customParser) {
      return this.options.customParser(filePath, format);
    }

    // Use built-in parsers based on format
    switch (format) {
      case 'openapi':
        return parseOpenAPIFile(filePath);

      case 'protobuf': {
        // Dynamic import to avoid loading protobufjs if not needed
        const { parseProtobufFile } = await import(
          '../parsers/protobuf.js'
        );
        return parseProtobufFile(filePath);
      }

      case 'graphql': {
        const { parseGraphQLFile } = await import(
          '../parsers/graphql.js'
        );
        return parseGraphQLFile(filePath);
      }

      default:
        throw new ChameleonError(
          `Unsupported schema format: ${format}`,
          'HOT_RELOAD_UNSUPPORTED_FORMAT'
        );
    }
  }

  /**
   * Create a timeout promise that rejects after the specified duration
   */
  private createTimeout(
    ms: number,
    signal: AbortSignal
  ): Promise<never> {
    return new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new ChameleonError(
            `Schema compilation timed out after ${ms}ms`,
            'HOT_RELOAD_TIMEOUT'
          )
        );
      }, ms);

      // Clean up if aborted
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(
          new ChameleonError(
            'Compilation was cancelled',
            'HOT_RELOAD_CANCELLED'
          )
        );
      });
    });
  }

  /**
   * Update state and emit state change
   */
  private setState(newState: ReloadState): void {
    this.state = newState;
    this.emitter.emit('stateChange', newState);
  }

  /**
   * Add an entry to the reload history
   */
  private addHistoryEntry(entry: ReloadHistoryEntry): void {
    this.history.push(entry);

    // Trim history if needed
    while (this.history.length > this.options.maxHistorySize) {
      this.history.shift();
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a hot reload manager with default options
 */
export function createHotReloadManager(
  options?: HotReloadOptions
): HotReloadManager {
  return new HotReloadManager(options);
}
