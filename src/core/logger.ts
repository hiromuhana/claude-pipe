import type { Logger } from './types.js'

function emit(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, unknown>): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(data ?? {})
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload))
}

/** Simple JSON logger used across runtime modules. */
export const logger: Logger = {
  info(event, data) {
    emit('INFO', event, data)
  },
  warn(event, data) {
    emit('WARN', event, data)
  },
  error(event, data) {
    emit('ERROR', event, data)
  }
}
