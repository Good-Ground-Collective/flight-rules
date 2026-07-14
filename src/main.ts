#!/usr/bin/env node
// Executable entry point for the bundled CLI. Kept separate from cli.ts so the
// bundle always runs when invoked — no argv-based "am I the main module"
// sniffing, which silently no-ops when the binary is renamed or wrapped.
import { CommanderError } from 'commander'
import { run } from './cli.js'

run(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CommanderError) {
    // Commander already wrote help/usage/error output; just honor its exit code.
    process.exit(err.exitCode)
  }
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
