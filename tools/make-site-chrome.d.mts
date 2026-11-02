// Types for tools/make-site-chrome.mjs (used by tools/make-trust.ts and a test).
export interface ChromeCfg { loginId?: string; icons?: boolean; allBadges?: boolean; legacyFirst?: string[]; css?: string[]; console?: boolean; light?: boolean; footer?: boolean; bar?: boolean; current?: string; source?: string; scripts?: string; between?: string; bodyClass?: string; skip?: string }
export const PAGES: Record<string, ChromeCfg>;
export const MENU: string[][];
export const NAME: string;
export const V: { kit: number; site: number; icons: number; bar: number };
export function build(file: string, cfg?: ChromeCfg, src?: string): string;
export function header(o?: ChromeCfg): string;
export function footer(): string;
export function headAssets(o?: ChromeCfg): string;
export const SPRITE: string;
