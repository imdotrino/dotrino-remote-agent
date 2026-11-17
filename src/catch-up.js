/**
 * catch-up.js — ponerse al día con la bóveda ANTES de rechazar a alguien.
 *
 * El agente trae el acta cada pocos minutos. Entre un tic y el siguiente no sabe de un aparato
 * recién emparejado, y lo rechazaba. `makeCatchUp` da una función que trae el acta en el momento
 * y contesta si avanzó — con un freno, porque un saludo lo puede mandar cualquiera y no por eso se
 * le pregunta a la bóveda cada vez.
 *
 * @param {{ refresh: () => Promise<void>, seq: () => (number|null|undefined), minGapMs?: number, now?: () => number }} o
 * @returns {() => Promise<boolean>} true si el acta avanzó (y vale la pena juzgar otra vez).
 */
export const CATCH_UP_GAP_MS = 10_000

/**
 * @param {{ refresh: () => Promise<unknown>, seq: () => number | null, minGapMs?: number, now?: () => number }} o
 * @returns {() => Promise<boolean>}
 */
export function makeCatchUp ({ refresh, seq, minGapMs = CATCH_UP_GAP_MS, now = Date.now }) {
  let last = -Infinity
  /** @type {Promise<boolean> | null} */
  let running = null
  return async () => {
    // Uno a la vez: los saludos que lleguen mientras tanto esperan a ese mismo y usan su resultado.
    if (running) return running
    if (now() - last < minGapMs) return false
    last = now()
    const before = seq()
    running = (async () => {
      try { await refresh() } catch (_) { return false }
      return seq() !== before
    })().finally(() => { running = null })
    return running
  }
}

/**
 * UN AVISO QUE CUALQUIERA PUEDE MANDAR no dispara el trabajo cada vez: como mucho una vez cada
 * `minGapMs`, y lo que llegue mientras tanto se junta en UNA llamada al final del hueco (así un
 * aviso de verdad entre basura no se pierde: llega tarde, como mucho `minGapMs`).
 * @param {() => Promise<unknown>} fn
 * @param {{ minGapMs?: number, now?: () => number, setTimer?: (f: () => void, ms: number) => unknown }} [o]
 * @returns {() => void}
 */
export function makeThrottle (fn, { minGapMs = CATCH_UP_GAP_MS, now = Date.now, setTimer = (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t } } = {}) {
  let last = -Infinity
  let pending = false
  const run = () => { last = now(); Promise.resolve().then(fn).catch(() => {}) }
  return () => {
    if (pending) return
    const wait = last + minGapMs - now()
    if (wait <= 0) return run()
    pending = true
    setTimer(() => { pending = false; run() }, wait)
  }
}
