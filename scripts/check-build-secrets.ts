/**
 * Fails when build output contains credentials (ADR 0018). `cds build` copies the
 * resolved configuration into gen/, including credentials from the environment
 * of whoever runs the build; a production artifact must never carry them.
 *
 *   tsx scripts/check-build-secrets.ts [dir ...]     (default: gen app/assistant/dist)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SECRET_KEYS =
  /^(password|passwd|secret|clientsecret|client_secret|apikey|api_key|token|key|privatekey|private_key)$/i

/** Values of secret-like environment variables, e.g. CDS_REQUIRES_DB_CREDENTIALS_PASSWORD. */
const envSecrets = Object.entries(process.env)
  .filter(([name, value]) => /PASSWORD|SECRET|TOKEN|API_?KEY/i.test(name) && value && value.length >= 8)
  .map(([name, value]) => ({ name, value: value! }))

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) yield* files(full)
    else yield full
  }
}

/** Paths of non-empty secret-like keys inside any `credentials` object. */
function credentialSecrets(value: unknown, at: string[] = [], inCredentials = false): string[] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => {
    const here = [...at, key]
    if (inCredentials && SECRET_KEYS.test(key) && typeof child === 'string' && child) return [here.join('.')]
    return credentialSecrets(child, here, inCredentials || key === 'credentials')
  })
}

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['gen', 'app/assistant/dist']
const findings: string[] = []

for (const dir of dirs.filter((d) => existsSync(d))) {
  for (const file of files(dir)) {
    const text = readFileSync(file, 'utf8')
    for (const { name } of envSecrets.filter((s) => text.includes(s.value))) {
      findings.push(`${file}: contains the value of $${name}`)
    }
    if (file.endsWith('.json')) {
      try {
        for (const key of credentialSecrets(JSON.parse(text))) findings.push(`${file}: credentials at ${key}`)
      } catch {
        // not JSON we can check
      }
    }
  }
}

if (findings.length) {
  console.error(`Build output contains credentials:\n  ${findings.join('\n  ')}`)
  console.error('Build in an environment without credentials (see Dockerfile) and remove the output.')
  process.exit(1)
}
console.log(`No credentials found in ${dirs.join(', ')}`)
