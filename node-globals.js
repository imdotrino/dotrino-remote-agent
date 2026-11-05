/**
 * Instala los globals del navegador que los paquetes del ecosistema esperan
 * cuando corren headless en Node: `WebSocket` (paquete `ws`) y un `localStorage`
 * respaldado en archivo (lo usa `@dotrino/proxy-client` para su keypair de
 * transporte estable). Mismo patrón que `dotrino-bots/src/core/node-globals.js`
 * — NO se reimplementa nada, solo se inyecta el entorno.
 *
 * Solo para uso del lado del AGENTE (Node). No importar desde entrypoints de
 * navegador.
 */
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'

/** localStorage síncrono respaldado por un archivo JSON (solo lo que usan los paquetes). */
/**
 * @param {string} filePath
 * @returns {Storage}
 */
export function fileLocalStorage (filePath) {
  /** @type {Record<string, string>} */
  let data = {}
  try { if (fs.existsSync(filePath)) data = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {} } catch (_) {}
  const flush = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data), { mode: 0o600 })
  }
  return {
    getItem: (/** @type {string} */ k) => (k in data ? data[k] : null),
    setItem: (/** @type {string} */ k, /** @type {unknown} */ v) => { data[k] = String(v); flush() },
    removeItem: (/** @type {string} */ k) => { delete data[k]; flush() },
    clear: () => { data = {}; flush() },
    key: (/** @type {number} */ i) => Object.keys(data)[i] ?? null,
    get length () { return Object.keys(data).length }
  }
}

let _installed = false
/** @param {string} dir  dónde vive `transport.json` (la llave de transporte del proxy-client) */
export function installNodeGlobals (dir) {
  if (_installed) return
  if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = /** @type {typeof globalThis.WebSocket} */ (/** @type {unknown} */ (WebSocket))  // `ws` cumple la API que usa el proxy-client

  // Node ≥22 expone un `localStorage` NO funcional sin `--localstorage-file`, así
  // que aquí se pone el shim de archivo igual. Pero se pone con `defineProperty` y
  // NO asignando:
  //
  //   · lo que Node define es un ACCESOR (getter/setter nativos), y asignarle
  //     revienta con «Cannot assign to read only property 'localStorage'» — medido
  //     en Node 25.9. Con la asignación, cualquier agente headless dejaba de
  //     arrancar su plano de control en un Node moderno, y el mensaje no decía nada
  //     de esto;
  //   · el descriptor tampoco se LEE (nada de `globalThis.localStorage`): tocar el
  //     getter nativo sin el flag emite un warning por consola.
  //
  // Es lo mismo que hace `@dotrino/vault`, que ya se topó con esto.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: fileLocalStorage(path.join(dir, 'transport.json'))
  })
  _installed = true
}
