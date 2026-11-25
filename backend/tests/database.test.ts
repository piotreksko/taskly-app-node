import { PrismaPg } from '@prisma/adapter-pg';
import { it, expect, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import type { Database } from '../src/features/todos/types.ts';

vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: vi.fn(function PrismaPg() {}) }));
vi.mock('../src/generated/prisma/client.ts', () => ({ PrismaClient: vi.fn(function PrismaClient() {}) }));

it('creates a Prisma client backed by the pg adapter with a connection timeout', () => {
  const client = createDatabase('postgresql://u:p@localhost:5432/db');
  expect(PrismaPg).toHaveBeenCalledWith({ connectionString: 'postgresql://u:p@localhost:5432/db', connectionTimeoutMillis: 10000 });
  const adapter = vi.mocked(PrismaPg).mock.instances[0];
  expect(PrismaClient).toHaveBeenCalledWith({ adapter });
  expect(client).toBe(vi.mocked(PrismaClient).mock.instances[0]);
});

it('creates the todos table idempotently with its constraints', async () => {
  const executeRaw = vi.fn().mockResolvedValue(0);
  await initialize({ $executeRaw: executeRaw } as unknown as Database);
  expect(executeRaw).toHaveBeenCalledOnce();
  const [strings, ...values] = executeRaw.mock.calls[0];
  const sql = (strings as TemplateStringsArray).join('?');
  expect(values).toEqual([]);
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
  expect(sql).toContain('title VARCHAR(120) NOT NULL');
  expect(sql).toContain("CHECK (priority IN ('low', 'medium', 'high'))");
  expect(sql).toContain('created_at TIMESTAMPTZ NOT NULL');
});

it('propagates initialization failures', async () => {
  const executeRaw = vi.fn().mockRejectedValue(new Error('permission denied'));
  await expect(initialize({ $executeRaw: executeRaw } as unknown as Database)).rejects.toThrow('permission denied');
});
