import type { MicroclawConfig } from '../config/schema.js'
import { createExecTool } from '../tools/exec.js'
import { editFileTool } from '../tools/edit-file.js'
import { listDirTool } from '../tools/list-dir.js'
import { createMessageTool } from '../tools/message.js'
import { readFileTool } from '../tools/read-file.js'
import { webFetchTool } from '../tools/web-fetch.js'
import { createWebSearchTool } from '../tools/web-search.js'
import { writeFileTool } from '../tools/write-file.js'
import { MessageBus } from './bus.js'
import { ToolRegistry } from './tool-registry.js'

/** Registers all v1 tools in deterministic order. */
export function registerTools(registry: ToolRegistry, config: MicroclawConfig, bus: MessageBus): void {
  registry.register(readFileTool)
  registry.register(writeFileTool)
  registry.register(editFileTool)
  registry.register(listDirTool)
  registry.register(createExecTool(config.tools.execTimeoutSec))
  registry.register(createWebSearchTool(config.tools.webSearchApiKey))
  registry.register(webFetchTool)
  registry.register(createMessageTool(bus))
}
