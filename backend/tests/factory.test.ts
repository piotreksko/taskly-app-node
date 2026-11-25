import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import type { Database } from '../src/features/todos/types.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const todoDelegate = {
    findFirst: vi.fn().mockResolvedValue({ id: 1 }),
    findMany: vi.fn().mockResolvedValue([record]),
    create: vi.fn().mockResolvedValue(record),
  };
  const app = createApp({ todo: todoDelegate } as unknown as Database);
  return { app, todoDelegate };
}

it('mounts the health and todo routers under /api', async () => {
  const { app } = setup();
  expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
});

it('does not advertise the framework', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/health');
  expect(response.headers['x-powered-by']).toBeUndefined();
});

it('serves the OpenAPI specification and Swagger UI', async () => {
  const { app } = setup();
  const spec = await request(app).get('/openapi.json');
  expect(spec.status).toBe(200);
  expect(spec.body).toMatchObject({
    openapi: expect.stringMatching(/^3\./),
    paths: expect.objectContaining({ '/api/health': expect.any(Object), '/api/todos': expect.any(Object) }),
  });
  const docs = await request(app).get('/docs/');
  expect(docs.status).toBe(200);
  expect(docs.headers['content-type']).toMatch(/text\/html/);
});

it('returns a JSON 404 for unknown routes', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/unknown');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});

it('rejects malformed JSON with 422', async () => {
  const { app, todoDelegate } = setup();
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  expect(todoDelegate.create).not.toHaveBeenCalled();
});

it('rejects bodies over the JSON size limit with 413', async () => {
  const { app, todoDelegate } = setup();
  const response = await request(app).post('/api/todos').send({ title: 'Task', description: 'x'.repeat(200 * 1024) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
  expect(todoDelegate.create).not.toHaveBeenCalled();
});

it('hides unexpected errors behind a generic 500 and logs them', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { app, todoDelegate } = setup();
  const failure = new Error('connection lost');
  todoDelegate.findMany.mockRejectedValue(failure);
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(response.text).not.toContain('connection lost');
  expect(log).toHaveBeenCalledWith(failure);
});
