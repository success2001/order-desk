// Reads SUPABASE_DB_URL from .env.supabase.local (session pooler connection string)
// and returns it percent-encoded, plus the password forms to redact from output.

export const DB_ENV_FILE = '.env.supabase.local'

export function loadDbUrl(envFile = DB_ENV_FILE) {
  try {
    process.loadEnvFile(envFile)
  } catch {
    throw new Error(`Missing ${envFile}. Add SUPABASE_DB_URL=<session pooler connection string>.`)
  }
  const raw = process.env.SUPABASE_DB_URL?.trim()
  if (!raw) throw new Error(`SUPABASE_DB_URL is not set in ${envFile}.`)

  // Split on the LAST "@" so passwords containing "@" still parse.
  const match = raw.match(/^(postgres(?:ql)?:\/\/[^:/]+:)(.*)@([^@]+)$/)
  if (!match) throw new Error(`SUPABASE_DB_URL in ${envFile} is not a postgresql://user:password@host/db URL.`)
  const [, prefix, rawPassword, rest] = match
  if (rawPassword.includes('[YOUR-PASSWORD]')) throw new Error(`Replace [YOUR-PASSWORD] in ${envFile} with the database password.`)

  let password = rawPassword
  try {
    password = decodeURIComponent(rawPassword) // accept already-encoded passwords
  } catch {
    // not encoded; use as-is
  }
  return { url: `${prefix}${encodeURIComponent(password)}@${rest}`, secrets: [rawPassword, password] }
}

export function redact(text, secrets) {
  let out = text
  for (const s of new Set(secrets.filter(Boolean).flatMap((s) => [s, encodeURIComponent(s)]))) {
    out = out.split(s).join('****')
  }
  return out
}
