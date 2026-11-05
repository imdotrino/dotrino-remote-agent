/** @typedef {import('./shapes.js').DotrinoActa} DotrinoActa */
/**
 * @param {{ link: import('./link.js').AgentLink, candidate: DotrinoActa | null | undefined, me: string }} args  `me` = la llave pública de esta máquina.
 * @returns {Promise<{ adopt: boolean, reason: string }>}
 */
export function adoptRecord({ link, candidate, me }: {
    link: import("./link.js").AgentLink;
    candidate: DotrinoActa | null | undefined;
    me: string;
}): Promise<{
    adopt: boolean;
    reason: string;
}>;
declare namespace _default {
    export { adoptRecord };
}
export default _default;
export type DotrinoActa = import("./shapes.js").DotrinoActa;
