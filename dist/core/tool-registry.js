/**
 * In-memory registry of all model-callable tools.
 */
export class ToolRegistry {
    tools = new Map();
    /** Registers or replaces a tool by name. */
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    /** Gets a tool by name. */
    get(name) {
        return this.tools.get(name);
    }
    /** Returns all tools in registration order. */
    list() {
        return [...this.tools.values()];
    }
}
