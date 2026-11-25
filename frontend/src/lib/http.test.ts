import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { request } from './http'

const fetchMock = vi.fn()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

it('prefixes the API path, sends JSON headers and returns the parsed body', async () => {
  fetchMock.mockResolvedValue(json([{ id: 1 }]))
  await expect(
    request('/todos', { method: 'POST', headers: { 'X-Trace': 'abc' } }),
  ).resolves.toEqual([{ id: 1 }])
  expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
  })
})

it('returns undefined for 204 No Content', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  await expect(request('/todos/1', { method: 'DELETE' })).resolves.toBe(
    undefined,
  )
})

it('explains validation failures in plain language', async () => {
  fetchMock.mockResolvedValue(json({ detail: [{ path: ['title'] }] }, 422))
  await expect(request('/todos')).rejects.toThrow(
    'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
  )
})

it('surfaces a string detail returned by the server', async () => {
  fetchMock.mockResolvedValue(json({ detail: 'Task not found.' }, 404))
  await expect(request('/todos/9')).rejects.toThrow('Task not found.')
})

it.each([
  [
    'a non-JSON body',
    () => new Response('<html>Bad gateway</html>', { status: 502 }),
  ],
  ['a non-string detail', () => json({ detail: { code: 1 } }, 500)],
])('falls back to a generic message for %s', async (_, response) => {
  fetchMock.mockResolvedValue(response())
  await expect(request('/todos')).rejects.toThrow(
    'The operation failed. Please try again.',
  )
})

it('replaces network errors with a friendly message', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(request('/todos')).rejects.toThrow(
    'Cannot connect to the server. Please try again.',
  )
})

it('rethrows the original error when the request was aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  const abort = new DOMException('Aborted', 'AbortError')
  fetchMock.mockRejectedValue(abort)
  await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
    abort,
  )
})
