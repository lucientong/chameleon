/**
 * Stream Bridge
 *
 * Bridges gRPC streaming with WebSocket and Server-Sent Events (SSE).
 * Provides adapters for different streaming transports and integrates
 * with GraphQL Subscriptions.
 *
 * Supported bridges:
 * - gRPC Server Stream → SSE
 * - gRPC Server Stream → WebSocket
 * - WebSocket → gRPC Client Stream
 * - WebSocket ↔ gRPC Bidirectional Stream
 * - gRPC Server Stream → GraphQL Subscription (AsyncIterator)
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebSocket as WsWebSocket } from 'ws';
import type {
  IRMethod,
  StreamingMode,
} from '../parsers/ir.js';
import { RuntimeError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A streaming message in the bridge
 */
export interface StreamMessage<T = unknown> {
  /** Message data */
  data: T;
  /** Message type identifier */
  type?: string;
  /** Message ID for SSE */
  id?: string;
  /** Timestamp */
  timestamp: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Stream event types
 */
export type StreamEvent =
  | 'data'
  | 'error'
  | 'end'
  | 'close'
  | 'drain'
  | 'resume'
  | 'pause';

/**
 * Stream status
 */
export type StreamStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'paused'
  | 'closing'
  | 'closed'
  | 'error';

/**
 * Options for SSE bridge
 */
export interface SSEBridgeOptions {
  /** Custom event type name (default: 'message') */
  eventName?: string;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Retry interval for client reconnection in ms (default: 3000) */
  retryInterval?: number;
  /** Custom headers to add to SSE response */
  headers?: Record<string, string>;
  /** Maximum number of messages to buffer (default: 1000) */
  maxBufferSize?: number;
  /** Message serializer */
  serializer?: (data: unknown) => string;
}

/**
 * Options for WebSocket bridge
 */
export interface WebSocketBridgeOptions {
  /** Heartbeat/ping interval in ms (default: 30000) */
  pingInterval?: number;
  /** Connection timeout in ms (default: 60000) */
  connectionTimeout?: number;
  /** Maximum message size in bytes (default: 1MB) */
  maxMessageSize?: number;
  /** Message serializer */
  serializer?: (data: unknown) => string;
  /** Message deserializer */
  deserializer?: (data: string) => unknown;
  /** Custom protocol subprotocol */
  protocol?: string;
}

/**
 * Options for stream bridge
 */
export interface StreamBridgeOptions {
  /** SSE-specific options */
  sse?: SSEBridgeOptions;
  /** WebSocket-specific options */
  ws?: WebSocketBridgeOptions;
  /** Error handler */
  onError?: (error: Error, method?: IRMethod) => void;
  /** Connection lifecycle hooks */
  hooks?: StreamBridgeHooks;
}

/**
 * Lifecycle hooks for stream bridge
 */
export interface StreamBridgeHooks {
  /** Called when a new stream connection is established */
  onConnect?: (info: StreamConnectionInfo) => void | Promise<void>;
  /** Called when a stream connection is closed */
  onDisconnect?: (info: StreamConnectionInfo) => void | Promise<void>;
  /** Called before sending a message */
  onBeforeSend?: (message: StreamMessage) => StreamMessage | null;
  /** Called after receiving a message */
  onAfterReceive?: (message: StreamMessage) => StreamMessage | null;
}

/**
 * Stream connection information
 */
export interface StreamConnectionInfo {
  /** Connection ID */
  id: string;
  /** Transport type */
  transport: 'sse' | 'websocket';
  /** Connected method */
  method?: IRMethod;
  /** Service name */
  serviceName?: string;
  /** Connection timestamp */
  connectedAt: number;
  /** Client address */
  remoteAddress?: string;
  /** Stream status */
  status: StreamStatus;
}

/**
 * Generic stream source interface
 * Adapts different streaming backends (gRPC, mock, etc.)
 */
export interface StreamSource<T = unknown> {
  /** Subscribe to data events */
  on(event: 'data', handler: (data: T) => void): void;
  /** Subscribe to error events */
  on(event: 'error', handler: (error: Error) => void): void;
  /** Subscribe to end events */
  on(event: 'end', handler: () => void): void;
  /** Cancel/close the stream */
  cancel?(): void;
  /** Destroy the stream */
  destroy?(): void;
}

/**
 * Generic stream sink interface
 * Adapts different streaming backends for writing
 */
export interface StreamSink<T = unknown> {
  /** Write data to the stream */
  write(data: T): boolean;
  /** End the stream */
  end(): void;
  /** Subscribe to drain events */
  on(event: 'drain', handler: () => void): void;
}

/**
 * Statistics for stream bridge
 */
export interface StreamBridgeStats {
  /** Active SSE connections */
  activeSSEConnections: number;
  /** Active WebSocket connections */
  activeWebSocketConnections: number;
  /** Total messages sent */
  totalMessagesSent: number;
  /** Total messages received */
  totalMessagesReceived: number;
  /** Total errors */
  totalErrors: number;
  /** Total connections established */
  totalConnections: number;
  /** Total connections closed */
  totalDisconnections: number;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_SSE_OPTIONS: Required<SSEBridgeOptions> = {
  eventName: 'message',
  heartbeatInterval: 30000,
  retryInterval: 3000,
  headers: {},
  maxBufferSize: 1000,
  serializer: (data: unknown) => JSON.stringify(data),
};

const DEFAULT_WS_OPTIONS: Required<WebSocketBridgeOptions> = {
  pingInterval: 30000,
  connectionTimeout: 60000,
  maxMessageSize: 1024 * 1024,
  serializer: (data: unknown) => JSON.stringify(data),
  deserializer: (data: string) => JSON.parse(data) as unknown,
  protocol: 'chameleon-stream',
};

// ============================================================================
// SSE Adapter
// ============================================================================

/**
 * Server-Sent Events adapter
 * Bridges a streaming source to an HTTP SSE response
 */
export class SSEAdapter {
  private messageCount = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private status: StreamStatus = 'idle';
  private connectionInfo: StreamConnectionInfo;
  private options: Required<SSEBridgeOptions>;

  constructor(
    private res: ServerResponse,
    private source: StreamSource,
    options?: SSEBridgeOptions,
    private hooks?: StreamBridgeHooks
  ) {
    this.options = { ...DEFAULT_SSE_OPTIONS, ...options };
    this.connectionInfo = {
      id: this.generateId(),
      transport: 'sse',
      connectedAt: Date.now(),
      status: 'idle',
    };
  }

  /**
   * Start the SSE stream
   */
  async start(): Promise<void> {
    this.status = 'connecting';
    this.connectionInfo.status = 'connecting';

    // Set SSE headers
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...this.options.headers,
    });

    // Send retry interval
    this.res.write(`retry: ${this.options.retryInterval}\n\n`);

    this.status = 'open';
    this.connectionInfo.status = 'open';

    // Notify hook
    if (this.hooks?.onConnect) {
      await this.hooks.onConnect(this.connectionInfo);
    }

    // Start heartbeat
    this.startHeartbeat();

    // Listen to source
    this.source.on('data', (data: unknown) => {
      this.sendEvent(data);
    });

    this.source.on('error', (error: Error) => {
      this.sendError(error);
      void this.close();
    });

    this.source.on('end', () => {
      void this.close();
    });

    // Handle client disconnect
    this.res.on('close', () => {
      void this.close();
    });
  }

  /**
   * Send an SSE event
   */
  sendEvent(data: unknown, eventName?: string): void {
    if (this.status !== 'open') { return; }
    if (this.messageCount >= this.options.maxBufferSize) { return; }

    const message: StreamMessage = {
      data,
      type: eventName ?? this.options.eventName,
      id: String(this.messageCount++),
      timestamp: Date.now(),
    };

    // Apply hook
    const processed = this.hooks?.onBeforeSend
      ? this.hooks.onBeforeSend(message)
      : message;
    if (!processed) { return; }

    const serialized = this.options.serializer(processed.data);

    let event = '';
    if (processed.id) { event += `id: ${processed.id}\n`; }
    if (processed.type && processed.type !== 'message') {
      event += `event: ${processed.type}\n`;
    }
    event += `data: ${serialized}\n\n`;

    this.res.write(event);
  }

  /**
   * Send an SSE error event
   */
  private sendError(error: Error): void {
    if (this.status !== 'open') { return; }

    const errorData = JSON.stringify({
      error: error.message,
      code: error instanceof RuntimeError ? error.code : 'STREAM_ERROR',
    });

    this.res.write(`event: error\ndata: ${errorData}\n\n`);
  }

  /**
   * Close the SSE connection
   */
  async close(): Promise<void> {
    if (this.status === 'closed' || this.status === 'closing') { return; }

    this.status = 'closing';
    this.connectionInfo.status = 'closing';

    this.stopHeartbeat();

    if (this.source.cancel) {
      this.source.cancel();
    }

    // Notify hook
    if (this.hooks?.onDisconnect) {
      await this.hooks.onDisconnect(this.connectionInfo);
    }

    if (!this.res.writableEnded) {
      this.res.end();
    }

    this.status = 'closed';
    this.connectionInfo.status = 'closed';
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): StreamConnectionInfo {
    return { ...this.connectionInfo };
  }

  /**
   * Get current status
   */
  getStatus(): StreamStatus {
    return this.status;
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.options.heartbeatInterval <= 0) { return; }

    this.heartbeatTimer = setInterval(() => {
      if (this.status === 'open' && !this.res.writableEnded) {
        this.res.write(': heartbeat\n\n');
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Generate a unique connection ID
   */
  private generateId(): string {
    return `sse-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// ============================================================================
// WebSocket Adapter
// ============================================================================

/**
 * WebSocket adapter
 * Bridges streaming source/sink to a WebSocket connection
 */
export class WebSocketAdapter {
  private messageCount = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private status: StreamStatus = 'idle';
  private connectionInfo: StreamConnectionInfo;
  private options: Required<WebSocketBridgeOptions>;

  constructor(
    private ws: WsWebSocket,
    _streamingMode: StreamingMode,
    options?: WebSocketBridgeOptions,
    private hooks?: StreamBridgeHooks
  ) {
    void _streamingMode;
    this.options = { ...DEFAULT_WS_OPTIONS, ...options };
    this.connectionInfo = {
      id: this.generateId(),
      transport: 'websocket',
      connectedAt: Date.now(),
      status: 'idle',
    };
  }

  /**
   * Start the WebSocket bridge with a server stream source
   */
  async startServerStream(source: StreamSource): Promise<void> {
    this.status = 'connecting';
    this.connectionInfo.status = 'connecting';

    await this.notifyConnect();

    this.status = 'open';
    this.connectionInfo.status = 'open';
    this.startPing();

    source.on('data', (data: unknown) => {
      this.send(data);
    });

    source.on('error', (error: Error) => {
      this.sendError(error);
      void this.close();
    });

    source.on('end', () => {
      this.send({ type: 'stream_end' });
      void this.close();
    });

    this.ws.on('close', () => {
      if (source.cancel) { source.cancel(); }
      void this.handleClose();
    });

    this.ws.on('error', () => {
      if (source.cancel) { source.cancel(); }
      void this.handleClose();
    });
  }

  /**
   * Start the WebSocket bridge with a client stream sink
   */
  async startClientStream(sink: StreamSink): Promise<void> {
    this.status = 'connecting';
    this.connectionInfo.status = 'connecting';

    await this.notifyConnect();

    this.status = 'open';
    this.connectionInfo.status = 'open';
    this.startPing();

    this.ws.on('message', (raw: Buffer | string) => {
      try {
        const data = this.options.deserializer(
          typeof raw === 'string' ? raw : raw.toString('utf-8')
        );

        const message: StreamMessage = {
          data,
          timestamp: Date.now(),
          id: String(this.messageCount++),
        };

        const processed = this.hooks?.onAfterReceive
          ? this.hooks.onAfterReceive(message)
          : message;

        if (processed) {
          sink.write(processed.data);
        }
      } catch (error) {
        this.sendError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    this.ws.on('close', () => {
      sink.end();
      void this.handleClose();
    });

    this.ws.on('error', () => {
      sink.end();
      void this.handleClose();
    });
  }

  /**
   * Start the WebSocket bridge in bidirectional mode
   */
  async startBidiStream(
    source: StreamSource,
    sink: StreamSink
  ): Promise<void> {
    this.status = 'connecting';
    this.connectionInfo.status = 'connecting';

    await this.notifyConnect();

    this.status = 'open';
    this.connectionInfo.status = 'open';
    this.startPing();

    // Server → Client
    source.on('data', (data: unknown) => {
      this.send(data);
    });

    source.on('error', (error: Error) => {
      this.sendError(error);
      void this.close();
    });

    source.on('end', () => {
      this.send({ type: 'stream_end', direction: 'server' });
    });

    // Client → Server
    this.ws.on('message', (raw: Buffer | string) => {
      try {
        const data = this.options.deserializer(
          typeof raw === 'string' ? raw : raw.toString('utf-8')
        );

        const message: StreamMessage = {
          data,
          timestamp: Date.now(),
          id: String(this.messageCount++),
        };

        const processed = this.hooks?.onAfterReceive
          ? this.hooks.onAfterReceive(message)
          : message;

        if (processed) {
          sink.write(processed.data);
        }
      } catch (error) {
        this.sendError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    this.ws.on('close', () => {
      if (source.cancel) { source.cancel(); }
      sink.end();
      void this.handleClose();
    });

    this.ws.on('error', () => {
      if (source.cancel) { source.cancel(); }
      sink.end();
      void this.handleClose();
    });
  }

  /**
   * Send data through WebSocket
   */
  send(data: unknown): void {
    if (this.status !== 'open') { return; }
    if (this.ws.readyState !== 1 /* WebSocket.OPEN */) { return; }

    const message: StreamMessage = {
      data,
      timestamp: Date.now(),
      id: String(this.messageCount++),
    };

    const processed = this.hooks?.onBeforeSend
      ? this.hooks.onBeforeSend(message)
      : message;
    if (!processed) { return; }

    const serialized = this.options.serializer(processed.data);
    this.ws.send(serialized);
  }

  /**
   * Send an error through WebSocket
   */
  private sendError(error: Error): void {
    if (this.status !== 'open') { return; }
    if (this.ws.readyState !== 1) { return; }

    const errorMessage = JSON.stringify({
      type: 'error',
      error: error.message,
      code: error instanceof RuntimeError ? error.code : 'STREAM_ERROR',
    });

    this.ws.send(errorMessage);
  }

  /**
   * Close the WebSocket connection
   */
  async close(code?: number, reason?: string): Promise<void> {
    if (this.status === 'closed' || this.status === 'closing') { return; }
    this.status = 'closing';
    this.connectionInfo.status = 'closing';

    this.stopPing();

    if (this.ws.readyState === 1 /* WebSocket.OPEN */) {
      this.ws.close(code ?? 1000, reason ?? 'Stream ended');
    }

    await this.handleClose();
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): StreamConnectionInfo {
    return { ...this.connectionInfo };
  }

  /**
   * Get current status
   */
  getStatus(): StreamStatus {
    return this.status;
  }

  /**
   * Notify connection hook
   */
  private async notifyConnect(): Promise<void> {
    if (this.hooks?.onConnect) {
      await this.hooks.onConnect(this.connectionInfo);
    }
  }

  /**
   * Handle WebSocket close
   */
  private async handleClose(): Promise<void> {
    if (this.status === 'closed') { return; }

    this.stopPing();

    if (this.hooks?.onDisconnect) {
      await this.hooks.onDisconnect(this.connectionInfo);
    }

    this.status = 'closed';
    this.connectionInfo.status = 'closed';
  }

  /**
   * Start ping/pong timer
   */
  private startPing(): void {
    if (this.options.pingInterval <= 0) { return; }

    this.pingTimer = setInterval(() => {
      if (this.ws.readyState === 1) {
        this.ws.ping();
      }
    }, this.options.pingInterval);
  }

  /**
   * Stop ping timer
   */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Generate a unique connection ID
   */
  private generateId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// ============================================================================
// AsyncIterator Adapter (for GraphQL Subscriptions)
// ============================================================================

/**
 * Converts a StreamSource into an AsyncIterableIterator
 * This is the standard interface expected by GraphQL subscription resolvers
 */
export class StreamAsyncIterator<T = unknown>
  implements AsyncIterableIterator<T>
{
  private queue: Array<IteratorResult<T>> = [];
  private resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private done = false;

  constructor(source: StreamSource<T>) {
    source.on('data', (data: T) => {
      this.push({ value: data, done: false });
    });

    source.on('error', (error: Error) => {
      // Push error as a special value, then close
      this.push({
        value: { __error: error.message } as unknown as T,
        done: false,
      });
      this.end();
    });

    source.on('end', () => {
      this.end();
    });
  }

  /**
   * Push a value into the queue
   */
  private push(result: IteratorResult<T>): void {
    if (this.done) { return; }

    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(result);
    } else {
      this.queue.push(result);
    }
  }

  /**
   * End the iterator
   */
  private end(): void {
    if (this.done) { return; }
    this.done = true;

    const result: IteratorResult<T> = { value: undefined as T, done: true };

    // Resolve all pending
    for (const resolver of this.resolvers) {
      resolver(result);
    }
    this.resolvers.length = 0;
  }

  /**
   * Get the next value
   */
  async next(): Promise<IteratorResult<T>> {
    const queued = this.queue.shift();
    if (queued) { return queued; }

    if (this.done) {
      return { value: undefined as T, done: true };
    }

    return new Promise<IteratorResult<T>>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  /**
   * Return early (consumer done)
   */
  return(): Promise<IteratorResult<T>> {
    this.end();
    return Promise.resolve({ value: undefined as T, done: true });
  }

  /**
   * Throw into the iterator
   */
  throw(error?: unknown): Promise<IteratorResult<T>> {
    this.end();
    return Promise.reject(error);
  }

  /**
   * Make this iterable
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

// ============================================================================
// Stream Bridge Manager
// ============================================================================

/**
 * Manages stream bridge connections and provides factory methods
 */
export class StreamBridgeManager {
  private connections: Map<string, StreamConnectionInfo> = new Map();
  private options: StreamBridgeOptions;
  private stats: StreamBridgeStats = {
    activeSSEConnections: 0,
    activeWebSocketConnections: 0,
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    totalErrors: 0,
    totalConnections: 0,
    totalDisconnections: 0,
  };

  constructor(options?: StreamBridgeOptions) {
    this.options = options ?? {};
  }

  /**
   * Create an SSE adapter for a stream source
   */
  createSSEAdapter(
    res: ServerResponse,
    source: StreamSource,
    options?: SSEBridgeOptions
  ): SSEAdapter {
    const mergedOptions = { ...this.options.sse, ...options };
    const hooks = this.createTrackedHooks('sse');

    return new SSEAdapter(res, source, mergedOptions, hooks);
  }

  /**
   * Create a WebSocket adapter
   */
  createWebSocketAdapter(
    ws: WsWebSocket,
    streamingMode: StreamingMode,
    options?: WebSocketBridgeOptions
  ): WebSocketAdapter {
    const mergedOptions = { ...this.options.ws, ...options };
    const hooks = this.createTrackedHooks('websocket');

    return new WebSocketAdapter(ws, streamingMode, mergedOptions, hooks);
  }

  /**
   * Create an AsyncIterator from a stream source (for GraphQL subscriptions)
   */
  createAsyncIterator<T>(source: StreamSource<T>): StreamAsyncIterator<T> {
    return new StreamAsyncIterator(source);
  }

  /**
   * Bridge a gRPC server stream to SSE
   */
  async bridgeToSSE(
    _req: IncomingMessage,
    res: ServerResponse,
    source: StreamSource,
    options?: SSEBridgeOptions
  ): Promise<SSEAdapter> {
    const adapter = this.createSSEAdapter(res, source, options);
    await adapter.start();
    return adapter;
  }

  /**
   * Bridge a gRPC stream to WebSocket
   */
  async bridgeToWebSocket(
    ws: WsWebSocket,
    mode: StreamingMode,
    source?: StreamSource,
    sink?: StreamSink,
    options?: WebSocketBridgeOptions
  ): Promise<WebSocketAdapter> {
    const adapter = this.createWebSocketAdapter(ws, mode, options);

    switch (mode) {
      case 'server':
        if (!source) { throw new RuntimeError('Source required for server streaming'); }
        await adapter.startServerStream(source);
        break;
      case 'client':
        if (!sink) { throw new RuntimeError('Sink required for client streaming'); }
        await adapter.startClientStream(sink);
        break;
      case 'bidi':
        if (!source || !sink) {
          throw new RuntimeError(
            'Both source and sink required for bidirectional streaming'
          );
        }
        await adapter.startBidiStream(source, sink);
        break;
    }

    return adapter;
  }

  /**
   * Get all active connections
   */
  getConnections(): StreamConnectionInfo[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get statistics
   */
  getStats(): StreamBridgeStats {
    return { ...this.stats };
  }

  /**
   * Get active connection count
   */
  getActiveConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Close all active connections
   */
  closeAll(): void {
    this.connections.clear();
    this.stats.activeSSEConnections = 0;
    this.stats.activeWebSocketConnections = 0;
  }

  /**
   * Create tracked hooks that update stats
   */
  private createTrackedHooks(
    transport: 'sse' | 'websocket'
  ): StreamBridgeHooks {
    return {
      onConnect: async (info: StreamConnectionInfo): Promise<void> => {
        this.connections.set(info.id, info);
        this.stats.totalConnections++;
        if (transport === 'sse') {
          this.stats.activeSSEConnections++;
        } else {
          this.stats.activeWebSocketConnections++;
        }

        if (this.options.hooks?.onConnect) {
          await this.options.hooks.onConnect(info);
        }
      },
      onDisconnect: async (info: StreamConnectionInfo): Promise<void> => {
        this.connections.delete(info.id);
        this.stats.totalDisconnections++;
        if (transport === 'sse') {
          this.stats.activeSSEConnections = Math.max(
            0,
            this.stats.activeSSEConnections - 1
          );
        } else {
          this.stats.activeWebSocketConnections = Math.max(
            0,
            this.stats.activeWebSocketConnections - 1
          );
        }

        if (this.options.hooks?.onDisconnect) {
          await this.options.hooks.onDisconnect(info);
        }
      },
      onBeforeSend: (message: StreamMessage): StreamMessage | null => {
        this.stats.totalMessagesSent++;

        if (this.options.hooks?.onBeforeSend) {
          return this.options.hooks.onBeforeSend(message);
        }
        return message;
      },
      onAfterReceive: (message: StreamMessage): StreamMessage | null => {
        this.stats.totalMessagesReceived++;

        if (this.options.hooks?.onAfterReceive) {
          return this.options.hooks.onAfterReceive(message);
        }
        return message;
      },
    };
  }
}

// ============================================================================
// In-Memory Stream (for Testing)
// ============================================================================

/**
 * In-memory stream source for testing
 * Implements StreamSource interface with manual data pushing
 */
export class MemoryStreamSource<T = unknown> implements StreamSource<T> {
  private emitter = new EventEmitter();
  private ended = false;

  /**
   * Push data into the stream
   */
  push(data: T): void {
    if (this.ended) { return; }
    this.emitter.emit('data', data);
  }

  /**
   * Emit an error
   */
  error(err: Error): void {
    if (this.ended) { return; }
    this.emitter.emit('error', err);
  }

  /**
   * End the stream
   */
  end(): void {
    if (this.ended) { return; }
    this.ended = true;
    this.emitter.emit('end');
  }

  /**
   * Whether the stream has ended
   */
  isEnded(): boolean {
    return this.ended;
  }

  on(event: 'data', handler: (data: T) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'end', handler: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void {
    this.emitter.on(event, handler);
  }

  cancel(): void {
    this.end();
  }

  destroy(): void {
    this.end();
    this.emitter.removeAllListeners();
  }
}

/**
 * In-memory stream sink for testing
 */
export class MemoryStreamSink<T = unknown> implements StreamSink<T> {
  private emitter = new EventEmitter();
  private items: T[] = [];
  private ended = false;

  write(data: T): boolean {
    if (this.ended) { return false; }
    this.items.push(data);
    return true;
  }

  end(): void {
    this.ended = false;
    this.emitter.emit('end');
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.on(event, handler);
  }

  /**
   * Get all written items
   */
  getItems(): readonly T[] {
    return this.items;
  }

  /**
   * Whether the sink has ended
   */
  isEnded(): boolean {
    return this.ended;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a StreamBridgeManager instance
 */
export function createStreamBridgeManager(
  options?: StreamBridgeOptions
): StreamBridgeManager {
  return new StreamBridgeManager(options);
}

/**
 * Create an SSE adapter directly
 */
export function createSSEAdapter(
  res: ServerResponse,
  source: StreamSource,
  options?: SSEBridgeOptions
): SSEAdapter {
  return new SSEAdapter(res, source, options);
}

/**
 * Create a WebSocket adapter directly
 */
export function createWebSocketAdapter(
  ws: WsWebSocket,
  streamingMode: StreamingMode,
  options?: WebSocketBridgeOptions
): WebSocketAdapter {
  return new WebSocketAdapter(ws, streamingMode, options);
}

/**
 * Create an async iterator from a stream source
 */
export function createStreamAsyncIterator<T>(
  source: StreamSource<T>
): StreamAsyncIterator<T> {
  return new StreamAsyncIterator(source);
}
