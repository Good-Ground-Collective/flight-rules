/**
 * Replaced at build time by esbuild's `define` (see scripts/build.mjs). Absent
 * when running un-bundled (e.g. vitest, ts-node), hence the fallback below.
 */
declare const _appVersion: string

export const appVersion: string =
  typeof _appVersion === 'undefined' ? '0.0.0-dev' : _appVersion
