import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'

import { type Settings, writeSettings } from '../config/settings.js'

/* ------------------------------------------------------------------ */
/*  Readline helpers                                                   */
/* ------------------------------------------------------------------ */

function createInterface(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout })
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

/* ------------------------------------------------------------------ */
/*  Step 1 – Check Claude Code CLI availability                        */
/* ------------------------------------------------------------------ */

async function checkClaudeCli(): Promise<void> {
  const { execFileSync } = await import('node:child_process')
  try {
    execFileSync('claude', ['--version'], { stdio: 'pipe' })
  } catch {
    console.error(
      '\n✖  Claude Code CLI not found.\n' +
        '   Install it first: https://docs.anthropic.com/en/docs/claude-code\n'
    )
    process.exit(1)
  }
  console.log('✔  Claude Code CLI detected.\n')
}

/* ------------------------------------------------------------------ */
/*  Step 2 – Choose channel                                            */
/* ------------------------------------------------------------------ */

async function chooseChannel(rl: readline.Interface): Promise<'telegram' | 'discord'> {
  console.log('Which messaging platform do you want to use?\n  1) Telegram\n  2) Discord\n')
  const choice = await ask(rl, 'Enter 1 or 2: ')
  if (choice === '2') return 'discord'
  return 'telegram'
}

/* ------------------------------------------------------------------ */
/*  Step 3 / 4 – Collect bot credentials                               */
/* ------------------------------------------------------------------ */

async function collectCredentials(
  rl: readline.Interface,
  channel: 'telegram' | 'discord'
): Promise<string> {
  if (channel === 'telegram') {
    console.log(
      '\nCreate a Telegram bot:\n' +
        '  1. Open @BotFather in Telegram\n' +
        '  2. Send /newbot and follow the prompts\n' +
        '  3. Copy the bot token\n'
    )
  } else {
    console.log(
      '\nCreate a Discord bot:\n' +
        '  1. Go to https://discord.com/developers/applications\n' +
        '  2. Create a new application → Bot → Reset Token\n' +
        '  3. Copy the bot token\n'
    )
  }
  let token = ''
  while (!token) {
    token = await ask(rl, 'Paste your bot token: ')
  }
  return token
}

/* ------------------------------------------------------------------ */
/*  Step – Configure optional webhook server                           */
/* ------------------------------------------------------------------ */

interface WebhookSettings {
  enabled: boolean
  port: number
  url: string
  secret: string
}

async function configureWebhook(
  rl: readline.Interface,
  channel: 'telegram' | 'discord'
): Promise<WebhookSettings> {
  const disabled: WebhookSettings = { enabled: false, port: 3000, url: '', secret: '' }

  console.log(
    '\nWould you like to enable webhook mode?\n\n' +
      '  Webhooks let your bot receive messages via HTTP instead of polling.\n' +
      '  Recommended for production deployments and container environments.\n' +
      '  Requires a publicly accessible URL (or a tunnel like ngrok).\n\n' +
      '  1) No  – use default polling/gateway (simpler, great for development)\n' +
      '  2) Yes – configure a webhook server\n'
  )
  const choice = await ask(rl, 'Enter 1 or 2: ')
  if (choice !== '2') return disabled

  const portInput = await ask(rl, 'Webhook server port [3000]: ')
  const port = portInput ? Number(portInput) : 3000

  let url = ''
  while (!url) {
    url = await ask(rl, 'Public URL (e.g. https://yourdomain.com or https://xxx.ngrok-free.app): ')
  }

  let secret = ''
  if (channel === 'telegram') {
    console.log(
      '\n  Telegram supports a secret token to verify webhook requests.\n' +
        '  Leave blank to auto-generate one, or enter your own.\n'
    )
    const input = await ask(rl, 'Webhook secret [auto]: ')
    secret = input || generateSecret()
    console.log(`  ✔  Secret: ${secret}`)
  } else {
    console.log(
      '\n  Discord requires your application\'s public key for webhook verification.\n' +
        '  Find it at: https://discord.com/developers/applications → General Information\n'
    )
    while (!secret) {
      secret = await ask(rl, 'Application public key (hex): ')
    }
    console.log(
      '\n  After starting the bot, set your Interactions Endpoint URL in the\n' +
        `  Discord Developer Portal to: ${url.replace(/\/$/, '')}/webhook/discord\n`
    )
  }

  return { enabled: true, port, url: url.replace(/\/$/, ''), secret }
}

function generateSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  Step 5 – Choose model                                              */
/* ------------------------------------------------------------------ */

const MODEL_PRESETS: Record<string, string> = {
  '1': 'claude-haiku-4',
  '2': 'claude-sonnet-4-5',
  '3': 'claude-opus-4-5'
}

async function chooseModel(rl: readline.Interface): Promise<string> {
  console.log(
    '\nWhich model would you like to use?\n' +
      '  1) Haiku\n' +
      '  2) Sonnet 4.5\n' +
      '  3) Opus 4.5\n' +
      '  4) Other (free-form entry)\n'
  )
  const choice = await ask(rl, 'Enter 1–4: ')
  if (choice in MODEL_PRESETS) return MODEL_PRESETS[choice]!
  const custom = await ask(rl, 'Enter model name (e.g. Minimax, GLM-4.7, Kimi): ')
  return custom || 'claude-sonnet-4-5'
}

/* ------------------------------------------------------------------ */
/*  Step 6 – Choose workspace + create AGENTS.md                       */
/* ------------------------------------------------------------------ */

const DEFAULT_AGENTS_MD =
  '# AGENTS.md\n\n' +
  'This file configures the Claude agent for this workspace.\n\n' +
  '## Instructions\n\n' +
  '- Answer concisely and accurately.\n' +
  '- When modifying files, explain what changed.\n'

async function chooseWorkspace(rl: readline.Interface): Promise<string> {
  const cwd = process.cwd()
  const input = await ask(rl, `\nWorkspace path [${cwd}]: `)
  const workspace = input || cwd

  const resolved = path.resolve(workspace)
  fs.mkdirSync(resolved, { recursive: true })

  const agentsPath = path.join(resolved, 'AGENTS.md')
  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, DEFAULT_AGENTS_MD, 'utf-8')
    console.log(`✔  Created ${agentsPath}`)
  } else {
    console.log(`ℹ  ${agentsPath} already exists – skipping.`)
  }

  return resolved
}

/* ------------------------------------------------------------------ */
/*  Main onboarding flow                                               */
/* ------------------------------------------------------------------ */

export async function runOnboarding(): Promise<Settings> {
  console.log("\n🚀 Welcome to Claude Pipe!\n   Let's get you set up.\n")

  await checkClaudeCli()

  const rl = createInterface()
  try {
    const channel = await chooseChannel(rl)
    const token = await collectCredentials(rl, channel)
    const webhook = await configureWebhook(rl, channel)
    const model = await chooseModel(rl)
    const workspace = await chooseWorkspace(rl)

    const settings: Settings = {
      channel,
      token,
      allowFrom: [],
      model,
      workspace,
      ...(webhook.enabled ? { webhook } : {})
    }

    writeSettings(settings)
    console.log('\n✔  Settings saved. Run claude-pipe again to start the bot.\n')
    return settings
  } finally {
    rl.close()
  }
}
