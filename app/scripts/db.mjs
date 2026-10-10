// Database tasks against the remote Supabase project.
//
//   node scripts/db.mjs push [--dry-run]   apply new migrations (supabase/migrations)
//   node scripts/db.mjs test               run SQL tests (supabase/tests/*.sql)
//
// Reads SUPABASE_DB_URL from .env.supabase.local (session pooler connection string).
// The password is never printed: all output is redacted.

import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { loadDbUrl as readDbUrl, redact } from './dbUrl.mjs'

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function push({ url, secrets }, dryRun) {
  const cli = join('node_modules', 'supabase', 'dist', 'supabase.js')
  const args = [cli, 'db', 'push', '--db-url', url, '--yes', ...(dryRun ? ['--dry-run'] : [])]
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  process.stdout.write(redact(result.stdout ?? '', secrets))
  process.stderr.write(redact(result.stderr ?? '', secrets))
  if (result.error) fail(redact(result.error.message, secrets))
  process.exit(result.status ?? 1)
}

async function test({ url, secrets }) {
  const dir = join('supabase', 'tests')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) fail(`No .sql files in ${dir}.`)

  const sql = postgres(url, { ssl: 'require', max: 1, prepare: false, onnotice: () => {} })
  let failed = 0
  try {
    for (const file of files) {
      try {
        await sql.unsafe(readFileSync(join(dir, file), 'utf8'))
        console.log(`✓ ${file}`)
      } catch (err) {
        failed++
        console.error(`✗ ${file}: ${redact(String(err.message ?? err), secrets)}`)
      }
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
  console.log(`\n${files.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

const [command, ...flags] = process.argv.slice(2)
let db
try {
  db = readDbUrl()
} catch (err) {
  fail(err.message)
}
if (command === 'push') push(db, flags.includes('--dry-run'))
else if (command === 'test') await test(db)
else fail('Usage: node scripts/db.mjs <push [--dry-run] | test>')
