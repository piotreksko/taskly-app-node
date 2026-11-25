import dotenv from 'dotenv';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

// Never read a developer's real .env during unit tests.
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const parts = {
  POSTGRES_USER: 'taskly',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_HOST: 'db.internal',
  DB_PORT: '5433',
  POSTGRES_DB: 'taskly',
};

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
  for (const [name, value] of Object.entries(parts)) vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

it('loads the repository-root .env quietly at import time', () => {
  expect(dotenv.config).toHaveBeenCalledWith({ path: expect.stringMatching(/[\\/]\.env$/), quiet: true });
  const { path } = vi.mocked(dotenv.config).mock.calls[0][0] as { path: string };
  expect(path).not.toMatch(/[\\/]backend[\\/]\.env$/);
});

it('prefers an explicit override over the environment', () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://env/db');
  expect(resolveDatabaseUrl('postgresql://override/db')).toBe('postgresql://override/db');
});

it('uses DATABASE_URL when no override is given', () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://env:pw@host:5432/db');
  expect(resolveDatabaseUrl()).toBe('postgresql://env:pw@host:5432/db');
});

it('normalizes SQLAlchemy psycopg URLs to plain postgresql URLs', () => {
  expect(resolveDatabaseUrl('postgresql+psycopg://u:p@h:5432/d')).toBe('postgresql://u:p@h:5432/d');
});

it('builds the URL from the individual variables', () => {
  expect(resolveDatabaseUrl()).toBe('postgresql://taskly:secret@db.internal:5433/taskly');
});

it('percent-encodes credentials and the database name', () => {
  vi.stubEnv('POSTGRES_USER', 'us@r');
  vi.stubEnv('POSTGRES_PASSWORD', 'p@ss:w/rd#');
  vi.stubEnv('POSTGRES_DB', 'my db');
  const url = new URL(resolveDatabaseUrl());
  expect(decodeURIComponent(url.username)).toBe('us@r');
  expect(decodeURIComponent(url.password)).toBe('p@ss:w/rd#');
  expect(url.hostname).toBe('db.internal');
  expect(url.pathname).toBe('/my%20db');
});

it.each(Object.keys(parts))('fails fast when %s is missing', (name) => {
  vi.stubEnv(name, '');
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
