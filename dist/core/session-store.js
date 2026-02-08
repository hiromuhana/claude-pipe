import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/**
 * File-backed session ID map.
 *
 * Persists only conversation key -> Claude session ID metadata.
 */
export class SessionStore {
    path;
    map = {};
    constructor(path) {
        this.path = path;
    }
    /** Loads persisted map state and ensures data directory exists. */
    async init() {
        await mkdir(dirname(this.path), { recursive: true });
        try {
            const raw = await readFile(this.path, 'utf-8');
            this.map = JSON.parse(raw);
        }
        catch {
            this.map = {};
        }
    }
    /** Gets session mapping for a conversation key. */
    get(conversationKey) {
        return this.map[conversationKey];
    }
    /** Upserts conversation mapping and persists to disk atomically. */
    async set(conversationKey, sessionId) {
        this.map[conversationKey] = {
            sessionId,
            updatedAt: new Date().toISOString()
        };
        await this.persist();
    }
    async persist() {
        const tmp = `${this.path}.tmp`;
        await writeFile(tmp, JSON.stringify(this.map, null, 2), 'utf-8');
        await rename(tmp, this.path);
    }
}
