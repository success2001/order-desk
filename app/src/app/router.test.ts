import { describe, expect, it } from 'vitest'
import { parseRoute } from './router'

const id = '0f8a3c2e-1b4d-4e6f-9a7b-2c3d4e5f6a7b'

describe('parseRoute', () => {
  it.each([
    ['', { name: 'list' }],
    ['#', { name: 'list' }],
    ['#/', { name: 'list' }],
    ['#/new', { name: 'new' }],
    ['#/account', { name: 'account' }],
    ['#/dashboard', { name: 'dashboard' }],
    [`#/orders/${id}`, { name: 'detail', id }],
    [`#/orders/${id}/edit`, { name: 'edit', id }],
  ])('parses %j', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected)
  })

  it.each(['#/unknown', '#/orders/not-a-uuid', `#/orders/${id}/delete`])('falls back to the list for %j', (hash) => {
    expect(parseRoute(hash)).toEqual({ name: 'list' })
  })
})
