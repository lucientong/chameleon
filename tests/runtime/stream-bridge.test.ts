/**
 * Stream Bridge Tests
 *
 * Tests for SSE adapter, WebSocket adapter, AsyncIterator adapter,
 * StreamBridgeManager, and in-memory stream utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import {
  SSEAdapter,
  WebSocketAdapter,
  StreamAsyncIterator,
  StreamBridgeManager,
  MemoryStreamSource,
  MemoryStreamSink,
  createStreamBridgeManager,
  createSSEAdapter,
  createWebSocketAdapter,
  createStreamAsyncIterator,
} from '../../src/runtime/stream-bridge.js';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockResponse(): ServerResponse & {
  __written: string[];
  __headers: Record<string, string>;
  __statusCode: number;
  __ended: boolean;
} {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let ended = false;
  let statusCode = 200;
  const emitter = new EventEmitter();

  return {
    writeHead: vi.fn((code: number, hdrs: Record<string, string>) => {
      statusCode = code;
      Object.assign(headers, hdrs);
    }),
    write: vi.fn((data: string) => {
      written.push(data);
      return true;
    }),
    end: vi.fn(() => {
      ended = true;
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
    }),
    emit: emitter.emit.bind(emitter),
    get writableEnded() {
      return ended;
    },
    __written: written,
    __headers: headers,
    get __statusCode() {
      return statusCode;
    },
    __ended: ended,
  } as unknown as ServerResponse & {
    __written: string[];
    __headers: Record<string, string>;
    __statusCode: number;
    __ended: boolean;
  };
}

function createMockWebSocket(): any {
  const emitter = new EventEmitter();
  const sent: string[] = [];
  let readyState = 1; // WebSocket.OPEN

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
    }),
    send: vi.fn((data: string) => {
      sent.push(data);
    }),
    close: vi.fn((code?: number, _reason?: string) => {
      readyState = 3; // CLOSED
      emitter.emit('close', code);
    }),
    ping: vi.fn(),
    get readyState() {
      return readyState;
    },
    set readyState(v: number) {
      readyState = v;
    },
    __sent: sent,
    __emitter: emitter,
  };
}

// ============================================================================
// Tests: MemoryStreamSource
// ============================================================================

describe('MemoryStreamSource', () => {
  it('should push data and emit events', () => {
    const source = new MemoryStreamSource<string>();
    const handler = vi.fn();

    source.on('data', handler);
    source.push('hello');
    source.push('world');

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith('hello');
    expect(handler).toHaveBeenCalledWith('world');
  });

  it('should emit end event', () => {
    const source = new MemoryStreamSource();
    const endHandler = vi.fn();

    source.on('end', endHandler);
    source.end();

    expect(endHandler).toHaveBeenCalledTimes(1);
    expect(source.isEnded()).toBe(true);
  });

  it('should not push after end', () => {
    const source = new MemoryStreamSource<string>();
    const handler = vi.fn();

    source.on('data', handler);
    source.end();
    source.push('should not be emitted');

    expect(handler).not.toHaveBeenCalled();
  });

  it('should emit error event', () => {
    const source = new MemoryStreamSource();
    const errorHandler = vi.fn();

    source.on('error', errorHandler);
    source.error(new Error('test error'));

    expect(errorHandler).toHaveBeenCalledTimes(1);
  });

  it('should cancel via cancel()', () => {
    const source = new MemoryStreamSource();
    source.cancel();
    expect(source.isEnded()).toBe(true);
  });

  it('should destroy and remove listeners', () => {
    const source = new MemoryStreamSource<string>();
    const handler = vi.fn();

    source.on('data', handler);
    source.destroy();
    source.push('should not be emitted');

    expect(handler).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: MemoryStreamSink
// ============================================================================

describe('MemoryStreamSink', () => {
  it('should write data', () => {
    const sink = new MemoryStreamSink<string>();

    sink.write('hello');
    sink.write('world');

    expect(sink.getItems()).toEqual(['hello', 'world']);
  });

  it('should end the sink', () => {
    const sink = new MemoryStreamSink();
    sink.end();
    // End event should be emitted
  });
});

// ============================================================================
// Tests: SSEAdapter
// ============================================================================

describe('SSEAdapter', () => {
  let mockRes: ReturnType<typeof createMockResponse>;
  let source: MemoryStreamSource<unknown>;

  beforeEach(() => {
    mockRes = createMockResponse();
    source = new MemoryStreamSource();
  });

  it('should start with proper SSE headers', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source
    );
    await adapter.start();

    expect(mockRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
    );
  });

  it('should send retry interval', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source,
      { retryInterval: 5000 }
    );
    await adapter.start();

    expect(mockRes.__written.some((w: string) => w.includes('retry: 5000'))).toBe(
      true
    );
  });

  it('should forward data as SSE events', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source
    );
    await adapter.start();

    source.push({ message: 'hello' });

    const dataEvents = mockRes.__written.filter((w: string) =>
      w.includes('data:')
    );
    expect(dataEvents.length).toBe(1);
    expect(dataEvents[0]).toContain('"message":"hello"');
  });

  it('should include event ID', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source
    );
    await adapter.start();

    source.push('test');

    const idEvents = mockRes.__written.filter((w: string) =>
      w.includes('id: ')
    );
    expect(idEvents.length).toBe(1);
  });

  it('should close on source end', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source,
      { heartbeatInterval: 0 }
    );
    await adapter.start();

    expect(adapter.getStatus()).toBe('open');

    source.end();

    // Allow async close to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adapter.getStatus()).toBe('closed');
  });

  it('should close on source error', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source,
      { heartbeatInterval: 0 }
    );
    await adapter.start();

    source.error(new Error('stream error'));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adapter.getStatus()).toBe('closed');
  });

  it('should provide connection info', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source
    );
    await adapter.start();

    const info = adapter.getConnectionInfo();
    expect(info.transport).toBe('sse');
    expect(info.status).toBe('open');
    expect(info.id).toMatch(/^sse-/);
  });

  it('should send custom event names', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source,
      { eventName: 'custom-event' }
    );
    await adapter.start();

    source.push('test');

    const events = mockRes.__written.filter((w: string) =>
      w.includes('event: custom-event')
    );
    expect(events.length).toBe(1);
  });

  it('should support custom headers', async () => {
    const adapter = new SSEAdapter(
      mockRes as unknown as ServerResponse,
      source,
      { headers: { 'X-Custom': 'value' } }
    );
    await adapter.start();

    expect(mockRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'X-Custom': 'value' })
    );
  });

  afterEach(async () => {
    source.end();
  });
});

// ============================================================================
// Tests: WebSocketAdapter
// ============================================================================

describe('WebSocketAdapter', () => {
  let mockWs: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    mockWs = createMockWebSocket();
  });

  it('should start server stream', async () => {
    const source = new MemoryStreamSource();
    const adapter = new WebSocketAdapter(
      mockWs,
      'server',
      { pingInterval: 0 }
    );

    await adapter.startServerStream(source);

    expect(adapter.getStatus()).toBe('open');

    source.push({ data: 'test' });

    expect(mockWs.__sent.length).toBe(1);
    expect(JSON.parse(mockWs.__sent[0])).toEqual({ data: 'test' });

    source.end();
  });

  it('should start client stream', async () => {
    const sink = new MemoryStreamSink();
    const adapter = new WebSocketAdapter(
      mockWs,
      'client',
      { pingInterval: 0 }
    );

    await adapter.startClientStream(sink);

    expect(adapter.getStatus()).toBe('open');

    // Simulate client sending data
    mockWs.__emitter.emit('message', JSON.stringify({ data: 'from-client' }));

    expect(sink.getItems().length).toBe(1);
    expect(sink.getItems()[0]).toEqual({ data: 'from-client' });
  });

  it('should start bidi stream', async () => {
    const source = new MemoryStreamSource();
    const sink = new MemoryStreamSink();
    const adapter = new WebSocketAdapter(
      mockWs,
      'bidi',
      { pingInterval: 0 }
    );

    await adapter.startBidiStream(source, sink);

    expect(adapter.getStatus()).toBe('open');

    // Server → Client
    source.push({ from: 'server' });
    expect(mockWs.__sent.length).toBe(1);

    // Client → Server
    mockWs.__emitter.emit('message', JSON.stringify({ from: 'client' }));
    expect(sink.getItems().length).toBe(1);

    source.end();
  });

  it('should send data via send()', async () => {
    const source = new MemoryStreamSource();
    const adapter = new WebSocketAdapter(
      mockWs,
      'server',
      { pingInterval: 0 }
    );

    await adapter.startServerStream(source);

    adapter.send({ custom: 'message' });

    const lastSent = mockWs.__sent[mockWs.__sent.length - 1];
    expect(JSON.parse(lastSent)).toEqual({ custom: 'message' });

    source.end();
  });

  it('should handle WebSocket close event', async () => {
    const source = new MemoryStreamSource();
    const adapter = new WebSocketAdapter(
      mockWs,
      'server',
      { pingInterval: 0 }
    );

    await adapter.startServerStream(source);

    // Simulate WebSocket close
    mockWs.__emitter.emit('close');

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adapter.getStatus()).toBe('closed');
  });

  it('should provide connection info', async () => {
    const source = new MemoryStreamSource();
    const adapter = new WebSocketAdapter(
      mockWs,
      'server',
      { pingInterval: 0 }
    );

    await adapter.startServerStream(source);

    const info = adapter.getConnectionInfo();
    expect(info.transport).toBe('websocket');
    expect(info.status).toBe('open');
    expect(info.id).toMatch(/^ws-/);

    source.end();
  });

  it('should close connection', async () => {
    const source = new MemoryStreamSource();
    const adapter = new WebSocketAdapter(
      mockWs,
      'server',
      { pingInterval: 0 }
    );

    await adapter.startServerStream(source);
    await adapter.close(1000, 'test close');

    expect(mockWs.close).toHaveBeenCalledWith(1000, 'test close');
    expect(adapter.getStatus()).toBe('closed');

    source.end();
  });
});

// ============================================================================
// Tests: StreamAsyncIterator
// ============================================================================

describe('StreamAsyncIterator', () => {
  it('should iterate over stream data', async () => {
    const source = new MemoryStreamSource<number>();
    const iterator = new StreamAsyncIterator(source);

    // Push data immediately
    source.push(1);
    source.push(2);
    source.push(3);
    source.end();

    const results: number[] = [];
    for await (const value of iterator) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should handle async data arrival', async () => {
    const source = new MemoryStreamSource<string>();
    const iterator = new StreamAsyncIterator(source);

    // Push data asynchronously
    setTimeout(() => {
      source.push('hello');
      source.push('world');
      source.end();
    }, 10);

    const results: string[] = [];
    for await (const value of iterator) {
      results.push(value);
    }

    expect(results).toEqual(['hello', 'world']);
  });

  it('should handle next() after end', async () => {
    const source = new MemoryStreamSource<number>();
    const iterator = new StreamAsyncIterator(source);

    source.push(1);
    source.end();

    const result1 = await iterator.next();
    expect(result1).toEqual({ value: 1, done: false });

    const result2 = await iterator.next();
    expect(result2.done).toBe(true);
  });

  it('should support return() for early termination', async () => {
    const source = new MemoryStreamSource<number>();
    const iterator = new StreamAsyncIterator(source);

    source.push(1);

    const result1 = await iterator.next();
    expect(result1.value).toBe(1);

    const result2 = await iterator.return();
    expect(result2.done).toBe(true);
  });

  it('should support throw()', async () => {
    const source = new MemoryStreamSource<number>();
    const iterator = new StreamAsyncIterator(source);

    await expect(iterator.throw(new Error('test'))).rejects.toThrow('test');
  });

  it('should handle errors from source', async () => {
    const source = new MemoryStreamSource<number>();
    const iterator = new StreamAsyncIterator(source);

    source.push(1);
    source.error(new Error('stream error'));

    const result1 = await iterator.next();
    expect(result1.value).toBe(1);

    // Error is converted to a special value
    const result2 = await iterator.next();
    expect((result2.value as any).__error).toBe('stream error');

    // Stream ends after error
    const result3 = await iterator.next();
    expect(result3.done).toBe(true);
  });
});

// ============================================================================
// Tests: StreamBridgeManager
// ============================================================================

describe('StreamBridgeManager', () => {
  it('should create SSE adapter', () => {
    const manager = new StreamBridgeManager();
    const res = createMockResponse() as unknown as ServerResponse;
    const source = new MemoryStreamSource();

    const adapter = manager.createSSEAdapter(res, source);
    expect(adapter).toBeInstanceOf(SSEAdapter);
  });

  it('should create WebSocket adapter', () => {
    const manager = new StreamBridgeManager();
    const ws = createMockWebSocket();

    const adapter = manager.createWebSocketAdapter(ws, 'server');
    expect(adapter).toBeInstanceOf(WebSocketAdapter);
  });

  it('should create AsyncIterator', () => {
    const manager = new StreamBridgeManager();
    const source = new MemoryStreamSource();

    const iterator = manager.createAsyncIterator(source);
    expect(iterator).toBeInstanceOf(StreamAsyncIterator);
  });

  it('should track active connections', async () => {
    const manager = new StreamBridgeManager();
    const res = createMockResponse() as unknown as ServerResponse;
    const source = new MemoryStreamSource();

    const adapter = manager.createSSEAdapter(res, source);
    await adapter.start();

    expect(manager.getActiveConnectionCount()).toBe(1);
    expect(manager.getConnections().length).toBe(1);
    expect(manager.getConnections()[0]!.transport).toBe('sse');

    source.end();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(manager.getActiveConnectionCount()).toBe(0);
  });

  it('should track statistics', async () => {
    const manager = new StreamBridgeManager();
    const res = createMockResponse() as unknown as ServerResponse;
    const source = new MemoryStreamSource();

    const adapter = manager.createSSEAdapter(res, source, {
      heartbeatInterval: 0,
    });
    await adapter.start();

    source.push({ test: 'data' });

    const stats = manager.getStats();
    expect(stats.totalConnections).toBe(1);
    expect(stats.totalMessagesSent).toBe(1);
    expect(stats.activeSSEConnections).toBe(1);

    source.end();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const finalStats = manager.getStats();
    expect(finalStats.totalDisconnections).toBe(1);
    expect(finalStats.activeSSEConnections).toBe(0);
  });

  it('should close all connections', async () => {
    const manager = new StreamBridgeManager();

    // Create some adapters
    const res1 = createMockResponse() as unknown as ServerResponse;
    const source1 = new MemoryStreamSource();
    const adapter1 = manager.createSSEAdapter(res1, source1);
    await adapter1.start();

    expect(manager.getActiveConnectionCount()).toBe(1);

    manager.closeAll();

    expect(manager.getActiveConnectionCount()).toBe(0);

    source1.end();
  });

  it('should invoke lifecycle hooks', async () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const onBeforeSend = vi.fn((msg) => msg);
    const onAfterReceive = vi.fn((msg) => msg);

    const manager = new StreamBridgeManager({
      hooks: { onConnect, onDisconnect, onBeforeSend, onAfterReceive },
    });

    const res = createMockResponse() as unknown as ServerResponse;
    const source = new MemoryStreamSource();

    const adapter = manager.createSSEAdapter(res, source, {
      heartbeatInterval: 0,
    });
    await adapter.start();

    expect(onConnect).toHaveBeenCalledTimes(1);

    source.push('data');
    expect(onBeforeSend).toHaveBeenCalledTimes(1);

    source.end();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('should bridge to SSE', async () => {
    const manager = new StreamBridgeManager();
    const req = {} as any;
    const res = createMockResponse() as unknown as ServerResponse;
    const source = new MemoryStreamSource();

    const adapter = await manager.bridgeToSSE(req, res, source, {
      heartbeatInterval: 0,
    });

    expect(adapter).toBeInstanceOf(SSEAdapter);
    expect(adapter.getStatus()).toBe('open');

    source.end();
  });

  it('should bridge to WebSocket for server stream', async () => {
    const manager = new StreamBridgeManager();
    const ws = createMockWebSocket();
    const source = new MemoryStreamSource();

    const adapter = await manager.bridgeToWebSocket(
      ws,
      'server',
      source,
      undefined,
      { pingInterval: 0 }
    );

    expect(adapter).toBeInstanceOf(WebSocketAdapter);
    expect(adapter.getStatus()).toBe('open');

    source.end();
  });

  it('should bridge to WebSocket for client stream', async () => {
    const manager = new StreamBridgeManager();
    const ws = createMockWebSocket();
    const sink = new MemoryStreamSink();

    const adapter = await manager.bridgeToWebSocket(
      ws,
      'client',
      undefined,
      sink,
      { pingInterval: 0 }
    );

    expect(adapter).toBeInstanceOf(WebSocketAdapter);
    expect(adapter.getStatus()).toBe('open');
  });

  it('should bridge to WebSocket for bidi stream', async () => {
    const manager = new StreamBridgeManager();
    const ws = createMockWebSocket();
    const source = new MemoryStreamSource();
    const sink = new MemoryStreamSink();

    const adapter = await manager.bridgeToWebSocket(
      ws,
      'bidi',
      source,
      sink,
      { pingInterval: 0 }
    );

    expect(adapter).toBeInstanceOf(WebSocketAdapter);
    expect(adapter.getStatus()).toBe('open');

    source.end();
  });

  it('should throw for server stream without source', async () => {
    const manager = new StreamBridgeManager();
    const ws = createMockWebSocket();

    await expect(
      manager.bridgeToWebSocket(ws, 'server')
    ).rejects.toThrow(/Source required/);
  });

  it('should throw for client stream without sink', async () => {
    const manager = new StreamBridgeManager();
    const ws = createMockWebSocket();

    await expect(
      manager.bridgeToWebSocket(ws, 'client')
    ).rejects.toThrow(/Sink required/);
  });

  it('should throw for bidi stream without both source and sink', async () => {
    const manager = new StreamBridgeManager();
    const ws = createMockWebSocket();

    await expect(
      manager.bridgeToWebSocket(ws, 'bidi')
    ).rejects.toThrow(/Both source and sink required/);
  });
});

// ============================================================================
// Tests: Convenience Functions
// ============================================================================

describe('Convenience Functions', () => {
  it('createStreamBridgeManager should create a manager', () => {
    const manager = createStreamBridgeManager();
    expect(manager).toBeInstanceOf(StreamBridgeManager);
  });

  it('createSSEAdapter should create an adapter', () => {
    const res = createMockResponse() as unknown as ServerResponse;
    const source = new MemoryStreamSource();

    const adapter = createSSEAdapter(res, source);
    expect(adapter).toBeInstanceOf(SSEAdapter);
  });

  it('createWebSocketAdapter should create an adapter', () => {
    const ws = createMockWebSocket();

    const adapter = createWebSocketAdapter(ws, 'server');
    expect(adapter).toBeInstanceOf(WebSocketAdapter);
  });

  it('createStreamAsyncIterator should create an iterator', () => {
    const source = new MemoryStreamSource();

    const iterator = createStreamAsyncIterator(source);
    expect(iterator).toBeInstanceOf(StreamAsyncIterator);
  });
});
