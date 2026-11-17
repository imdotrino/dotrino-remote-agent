/**
 * @param {{ refresh: () => Promise<unknown>, seq: () => number | null, minGapMs?: number, now?: () => number }} o
 * @returns {() => Promise<boolean>}
 */
export function makeCatchUp({ refresh, seq, minGapMs, now }: {
    refresh: () => Promise<unknown>;
    seq: () => number | null;
    minGapMs?: number;
    now?: () => number;
}): () => Promise<boolean>;
/**
 * UN AVISO QUE CUALQUIERA PUEDE MANDAR no dispara el trabajo cada vez: como mucho una vez cada
 * `minGapMs`, y lo que llegue mientras tanto se junta en UNA llamada al final del hueco (así un
 * aviso de verdad entre basura no se pierde: llega tarde, como mucho `minGapMs`).
 * @param {() => Promise<unknown>} fn
 * @param {{ minGapMs?: number, now?: () => number, setTimer?: (f: () => void, ms: number) => unknown }} [o]
 * @returns {() => void}
 */
export function makeThrottle(fn: () => Promise<unknown>, { minGapMs, now, setTimer }?: {
    minGapMs?: number;
    now?: () => number;
    setTimer?: (f: () => void, ms: number) => unknown;
}): () => void;
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
export const CATCH_UP_GAP_MS: 10000;
