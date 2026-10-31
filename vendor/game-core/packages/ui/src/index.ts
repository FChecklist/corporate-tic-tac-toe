// UI helpers shared by every game. Styles are tokens.css + components.css (copy both into the page); these functions build the small bits of markup.
import type { GoldenLabel } from "../../manifest/src";
export const MIN_TAP_PX = 44;
export type Look = "modern" | "retro";
export const setLook = (doc: Document, look: Look): void => { if (look === "retro") doc.documentElement.setAttribute("data-pt", "retro"); else doc.documentElement.removeAttribute("data-pt"); };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** The golden button. `label` comes from the game's manifest; a Claim game also needs the participant to press it. */
export const goldenButton = (label: GoldenLabel, disabled = false): string => `<button class="btn gold" type="button"${disabled ? " disabled" : ""}>${esc(label)}</button>`;
/** The EN button (English only; it shows the language, there is nothing to switch to). */
export const enButton = (): string => `<button class="en-btn" type="button" aria-label="English">EN</button>`;
/** A guided error: say what happened, then what to do next. */
export const guidedError = (what: string, doNext: string): string => `<div class="guided-error" role="alert">${esc(what)}<span class="do">${esc(doNext)}</span></div>`;
export const pausedBanner = (): string => `<div class="paused-banner" role="status">Paused</div>`;
export * from "./reactions";
