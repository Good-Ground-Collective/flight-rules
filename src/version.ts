// Replaced at build time by esbuild's `define` (see scripts/build.mjs).
// Falls back when running un-bundled (e.g. vitest, ts-node) where the define
// is absent.
declare const _appVersion: string

export const appVersion: string =
  typeof _appVersion === 'undefined' ? '0.0.0-dev' : _appVersion
