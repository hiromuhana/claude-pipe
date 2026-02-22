import { describe, expect, it } from 'vitest'

import { filterEnvForChild } from '../src/core/env-filter.js'

describe('filterEnvForChild', () => {
  it('passes through allowed system variables', () => {
    const env = filterEnvForChild({
      PATH: '/usr/bin',
      HOME: '/home/user',
      USER: 'user',
      LANG: 'en_US.UTF-8',
      SHELL: '/bin/bash',
      TERM: 'xterm'
    })

    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/user')
    expect(env.USER).toBe('user')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.SHELL).toBe('/bin/bash')
    expect(env.TERM).toBe('xterm')
  })

  it('passes through LLM API keys', () => {
    const env = filterEnvForChild({
      ANTHROPIC_API_KEY: 'sk-ant-xxx',
      OPENAI_API_KEY: 'sk-xxx'
    })

    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-xxx')
    expect(env.OPENAI_API_KEY).toBe('sk-xxx')
  })

  it('excludes CLAUDEPIPE_ variables', () => {
    const env = filterEnvForChild({
      PATH: '/usr/bin',
      CLAUDEPIPE_TELEGRAM_TOKEN: 'bot-secret-token',
      CLAUDEPIPE_DISCORD_TOKEN: 'discord-secret-token',
      CLAUDEPIPE_WORKSPACE: '/some/path'
    })

    expect(env.PATH).toBe('/usr/bin')
    expect(env.CLAUDEPIPE_TELEGRAM_TOKEN).toBeUndefined()
    expect(env.CLAUDEPIPE_DISCORD_TOKEN).toBeUndefined()
    expect(env.CLAUDEPIPE_WORKSPACE).toBeUndefined()
  })

  it('excludes unknown variables not in allow list', () => {
    const env = filterEnvForChild({
      PATH: '/usr/bin',
      SOME_SECRET: 'value',
      DATABASE_URL: 'postgres://...',
      AWS_SECRET_ACCESS_KEY: 'aws-key'
    })

    expect(env.PATH).toBe('/usr/bin')
    expect(env.SOME_SECRET).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  it('passes through NODE_ and LC_ prefixed variables', () => {
    const env = filterEnvForChild({
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=4096',
      LC_ALL: 'en_US.UTF-8'
    })

    expect(env.NODE_ENV).toBe('production')
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=4096')
    expect(env.LC_ALL).toBe('en_US.UTF-8')
  })

  it('skips undefined values', () => {
    const env = filterEnvForChild({
      PATH: '/usr/bin',
      HOME: undefined
    })

    expect(env.PATH).toBe('/usr/bin')
    expect('HOME' in env).toBe(false)
  })
})
