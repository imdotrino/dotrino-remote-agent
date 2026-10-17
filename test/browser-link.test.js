import test from 'node:test'
import assert from 'node:assert/strict'
import { linkFromIdentity } from '../src/browser-link.js'

const fake = (status, cert) => ({ vaultStatus: async () => status, getVaultCert: async () => (cert ? { cert } : null) })

test('emparejado: el enlace con lo que pide RemoteAgentClient', async () => {
  const id = fake({ paired: true, master: 'M', proxy: 'wss://p', deviceId: 'AB12-CD34', scope: ['vault:sign'] }, 'CERT')
  assert.deepEqual(await linkFromIdentity(id), { paired: true, id, cert: 'CERT', iss: 'M', proxy: 'wss://p', deviceId: 'AB12-CD34', scope: ['vault:sign'] })
})

test('sin emparejar, o con el cert vencido, no es un enlace', async () => {
  assert.equal((await linkFromIdentity(fake({ paired: false }))).paired, false)
  const r = await linkFromIdentity(fake({ paired: true, exp: 1 }, 'CERT'))
  assert.equal(r.paired, false); assert.equal(r.expired, true)
})

test('si la identidad no contesta, lanza: no se disfraza de «no emparejado»', async () => {
  const id = { vaultStatus: async () => { throw new Error('iframe gone') } }
  await assert.rejects(linkFromIdentity(id), /iframe gone/)
})
