/**
 * Filters environment variables for child CLI processes.
 *
 * Prevents bot-specific secrets (tokens, internal config) from leaking
 * into spawned Claude/Codex CLI subprocesses.
 */

const ALLOWED_PREFIXES = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_',
  'TERM',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_',
  'NODE_',
  'NPM_',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY'
]

const DENIED_PREFIXES = ['CLAUDEPIPE_']

function matchesAny(key: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => key === prefix || key.startsWith(prefix))
}

/**
 * Returns a copy of `env` containing only variables safe for child processes.
 *
 * - Denies any key starting with `CLAUDEPIPE_` (bot tokens, internal config).
 * - Allows keys matching well-known system/runtime prefixes plus LLM API keys.
 */
export function filterEnvForChild(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (matchesAny(key, DENIED_PREFIXES)) continue
    if (matchesAny(key, ALLOWED_PREFIXES)) {
      filtered[key] = value
    }
  }

  return filtered
}
