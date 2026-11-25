import express from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';
import type { Database } from '../src/features/todos/types.ts';

afterEach(() => vi.restoreAllMocks());

function setup(findFirst: ReturnType<typeof vi.fn>) {
  const database = { todo: { findFirst } } as unknown as Database;
  const app = express();
  app.use('/api', createHealthRouter(database));
  return app;
}

it('reports ok after a lightweight database query', async () => {
  const findFirst = vi.fn().mockResolvedValue(null);
  const response = await request(setup(findFirst)).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});

it('fails when the database is unavailable', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const findFirst = vi.fn().mockRejectedValue(new Error('connection refused'));
  const response = await request(setup(findFirst)).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).not.toEqual({ status: 'ok' });
});
