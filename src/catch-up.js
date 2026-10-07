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

export function makeCatchUp ({ refresh, seq, minGapMs = CATCH_UP_GAP_MS, now = Date.now }) {
  let last = -Infinity
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
