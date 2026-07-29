#!/usr/bin/env node
// Separate from cli.ts so the bundle always runs when invoked, without argv-based main-module sniffing that breaks when the binary is renamed.
import { CommanderError } from 'commander'
import { run } from './cli/cli.js'

run(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof CommanderError) {
    // Commander already wrote help/usage/error output; just honor its exit code.
    process.exit(err.exitCode)
  }
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
