// enrollInteractive (link.js): sin terminal delante no se intenta enlazar; se para con `no-tty`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrollInteractive } from '../src/link.js'

test('sin terminal delante, enrollInteractive para con no-tty', async () => {
  const was = process.stdin.isTTY
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
  try {
    await assert.rejects(() => enrollInteractive({ dir: '/nonexistent', label: 'x' }), { code: 'no-tty' })
  } finally { Object.defineProperty(process.stdin, 'isTTY', { value: was, configurable: true }) }
})
