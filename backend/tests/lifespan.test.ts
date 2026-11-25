import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { start } from '../src/core/lifespan.ts';
import { createDatabase, initialize } from '../src/core/database.ts';
import { resolveDatabaseUrl } from '../src/core/config.ts';
import { createApp } from '../src/factory.ts';

vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: vi.fn() }));
vi.mock('../src/factory.ts', () => ({ createApp: vi.fn() }));

type Handler = () => void;

function setup({ listenFails = false } = {}) {
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  // A fake HTTP server: no real sockets are opened.
  const server = Object.assign(new EventEmitter(), {
    address: vi.fn(() => ({ port: 8123 })),
    close: vi.fn(),
  });
  const app = {
    listen: vi.fn((port: number, host: string, callback: () => void) => {
      queueMicrotask(() => (listenFails ? server.emit('error', new Error('EADDRINUSE')) : callback()));
      return server;
    }),
  };
  vi.mocked(resolveDatabaseUrl).mockReturnValue('postgresql://test');
  vi.mocked(createDatabase).mockReturnValue(database as never);
  vi.mocked(initialize).mockResolvedValue(undefined);
  vi.mocked(createApp).mockReturnValue(app as never);
  const handlers: Record<string, Handler> = {};
  vi.spyOn(process, 'once').mockImplementation(((event: string, handler: Handler) => {
    handlers[event] = handler;
    return process;
  }) as typeof process.once);
  return { database, server, app, handlers };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  process.exitCode = undefined;
});

it('connects, initializes the schema, and listens on API_PORT', async () => {
  vi.stubEnv('API_PORT', '9001');
  const { database, server, app } = setup();
  const result = await start();
  expect(createDatabase).toHaveBeenCalledWith('postgresql://test');
  expect(database.$connect).toHaveBeenCalledOnce();
  expect(initialize).toHaveBeenCalledWith(database);
  expect(createApp).toHaveBeenCalledWith(database);
  expect(app.listen).toHaveBeenCalledWith(9001, '0.0.0.0', expect.any(Function));
  expect(console.log).toHaveBeenCalledWith('Taskly App Node API listening on port 8123');
  expect(result).toEqual({ server, database });
});

it('defaults to port 8000', async () => {
  vi.stubEnv('API_PORT', '');
  const { app } = setup();
  await start();
  expect(app.listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
});

it('registers graceful shutdown for SIGTERM and SIGINT', async () => {
  const { handlers } = setup();
  await start();
  expect(Object.keys(handlers).sort()).toEqual(['SIGINT', 'SIGTERM']);
  expect(handlers.SIGINT).toBe(handlers.SIGTERM);
});

it('closes the server, then disconnects the database on shutdown', async () => {
  vi.useFakeTimers();
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const { database, server, handlers } = setup();
  server.close.mockImplementation((callback: () => Promise<void>) => callback());
  await start();
  handlers.SIGTERM();
  await vi.waitFor(() => expect(database.$disconnect).toHaveBeenCalledOnce());
  expect(server.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10000);
  expect(exit).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});

it('reports a failed database disconnect through the exit code', async () => {
  const { database, server, handlers } = setup();
  const failure = new Error('disconnect failed');
  database.$disconnect.mockRejectedValue(failure);
  server.close.mockImplementation((callback: () => Promise<void>) => callback());
  await start();
  handlers.SIGINT();
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(failure));
  expect(process.exitCode).toBe(1);
});

it('forces exit when shutdown takes longer than 10 seconds', async () => {
  vi.useFakeTimers();
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const { handlers } = setup(); // server.close never calls back
  await start();
  handlers.SIGTERM();
  await vi.advanceTimersByTimeAsync(9999);
  expect(exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(exit).toHaveBeenCalledWith(1);
});

it('disconnects and rethrows when the database cannot connect', async () => {
  const { database, app } = setup();
  database.$connect.mockRejectedValue(new Error('ECONNREFUSED'));
  await expect(start()).rejects.toThrow('ECONNREFUSED');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(app.listen).not.toHaveBeenCalled();
});

it('disconnects and rethrows when the port cannot be bound', async () => {
  const { database, handlers } = setup({ listenFails: true });
  await expect(start()).rejects.toThrow('EADDRINUSE');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(handlers).toEqual({});
});
