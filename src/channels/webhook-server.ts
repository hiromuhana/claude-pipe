import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { Logger } from '../core/types.js'

export interface WebhookResponse {
  status: number
  body?: string
  headers?: Record<string, string>
}

export type WebhookHandler = (
  body: string,
  req: IncomingMessage
) => Promise<WebhookResponse>

/**
 * Lightweight HTTP server that routes webhook requests to channel handlers.
 *
 * Each channel registers a route (e.g. `/webhook/telegram`) and the server
 * dispatches incoming POST requests to the matching handler.
 */
export class WebhookServer {
  private server: Server | null = null
  private readonly routes = new Map<string, WebhookHandler>()

  constructor(
    private readonly port: number,
    private readonly host: string,
    private readonly logger: Logger
  ) {}

  /** Registers a POST route handler for the given path. */
  addRoute(path: string, handler: WebhookHandler): void {
    this.routes.set(path, handler)
  }

  /** Starts the HTTP server. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res)
      })

      this.server.on('error', (err) => {
        this.logger.error('webhook.server_error', { error: err.message })
        reject(err)
      })

      this.server.listen(this.port, this.host, () => {
        this.logger.info('webhook.listening', { port: this.port, host: this.host })
        resolve()
      })
    })
  }

  /** Stops the HTTP server. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => {
        this.logger.info('webhook.stopped')
        this.server = null
        resolve()
      })
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'method not allowed' }))
      return
    }

    const handler = this.routes.get(req.url ?? '')
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    try {
      const body = await readBody(req)
      const result = await handler(body, req)

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(result.headers ?? {})
      }
      res.writeHead(result.status, headers)
      res.end(result.body ?? '')
    } catch (error) {
      this.logger.error('webhook.handler_error', {
        path: req.url,
        error: error instanceof Error ? error.message : String(error)
      })
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal server error' }))
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}
