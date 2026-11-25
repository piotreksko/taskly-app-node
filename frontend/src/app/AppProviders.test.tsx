import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useTheme } from 'styled-components'
import { beforeEach, expect, it, vi } from 'vitest'
import { GlobalStyles, theme } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { AppProviders } from './AppProviders'

vi.mock('../design-system', () => import('../design-system/mocks'))

let seenClient: QueryClient | undefined
let seenTheme: unknown

function Probe() {
  seenClient = useQueryClient()
  seenTheme = useTheme()
  return <p>Application content</p>
}

beforeEach(() => {
  seenClient = undefined
  seenTheme = undefined
  vi.clearAllMocks()
})

it('renders children inside the query client and theme providers', () => {
  const client = new QueryClient()
  render(
    <AppProviders client={client}>
      <Probe />
    </AppProviders>,
  )
  expect(screen.getByText('Application content')).toBeVisible()
  expect(seenClient).toBe(client)
  expect(seenTheme).toBe(theme)
  expect(GlobalStyles).toHaveBeenCalled()
})

it('falls back to the shared application query client', () => {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  )
  expect(seenClient).toBe(queryClient)
})
