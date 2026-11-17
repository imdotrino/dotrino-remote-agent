/**
 * SI CONNECT FALLA, NO QUEDA NADA ABIERTO.
 *
 * El 2026-11-17 el agente de terminal acumuló 380 conexiones al proxio: cada intento de abrir
 * sesión con una máquina que contestaba `unauthorized` dejaba vivo su WebSocket (con
 * reconexión automática), porque `connect` lanzaba sin cerrarlo y quien llama no recibe el
 * cliente para hacerlo. Se agotaron las conexiones de nginx y nadie más pudo conectarse.
 *
 * Sin proxio de verdad: lo que se prueba es que el cliente que se creó se cierra.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketProxyClient } from '@dotrino/proxy-client'
import { RemoteAgentClient } from '../src/client.js'

test('un saludo rechazado cierra el cliente del proxio y lo suelta', async (t) => {
  let closed = 0
  const orig = WebSocketProxyClient.prototype.close
  WebSocketProxyClient.prototype.close = function () { closed++ }
  t.after(() => { WebSocketProxyClient.prototype.close = orig })

  const c = new RemoteAgentClient({ id: { me: {} }, proxy: 'wss://proxy.example.invalid' }, { agentPubkey: 'agente' })
  c._open = async () => { throw Object.assign(new Error('unauthorized: missing-cap terminal'), { code: 'unauthorized' }) }
  await assert.rejects(c.connect(), { code: 'unauthorized' })
  assert.equal(closed, 1, 'el WebSocket que abrió connect se cierra')
  assert.equal(c.client, null, 'y no queda colgado del objeto')
})

test('si sale bien, el cliente se queda abierto', async (t) => {
  let closed = 0
  const orig = WebSocketProxyClient.prototype.close
  WebSocketProxyClient.prototype.close = function () { closed++ }
  t.after(() => { WebSocketProxyClient.prototype.close = orig })

  const c = new RemoteAgentClient({ id: { me: {} }, proxy: 'wss://proxy.example.invalid' }, { agentPubkey: 'agente' })
  c._open = async () => {}
  assert.equal(await c.connect(), c)
  assert.equal(closed, 0)
  assert.ok(c.client)
})
