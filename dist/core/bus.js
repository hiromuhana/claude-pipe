/**
 * Minimal async message bus.
 *
 * Keeps channel adapters and the agent loop decoupled through inbound/outbound queues.
 */
export class MessageBus {
    inboundQueue = [];
    outboundQueue = [];
    inboundWaiters = [];
    outboundWaiters = [];
    /** Publishes an inbound message to the agent loop. */
    async publishInbound(msg) {
        const waiter = this.inboundWaiters.shift();
        if (waiter) {
            waiter(msg);
            return;
        }
        this.inboundQueue.push(msg);
    }
    /** Waits for and returns the next inbound message. */
    async consumeInbound() {
        const existing = this.inboundQueue.shift();
        if (existing)
            return existing;
        return new Promise((resolve) => this.inboundWaiters.push(resolve));
    }
    /** Publishes an outbound message for channel delivery. */
    async publishOutbound(msg) {
        const waiter = this.outboundWaiters.shift();
        if (waiter) {
            waiter(msg);
            return;
        }
        this.outboundQueue.push(msg);
    }
    /** Waits for and returns the next outbound message. */
    async consumeOutbound() {
        const existing = this.outboundQueue.shift();
        if (existing)
            return existing;
        return new Promise((resolve) => this.outboundWaiters.push(resolve));
    }
}
