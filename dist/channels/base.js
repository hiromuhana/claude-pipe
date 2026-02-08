/**
 * Shared helper for allow-list decisions.
 */
export function isSenderAllowed(senderId, allowFrom) {
    if (allowFrom.length === 0)
        return true;
    return allowFrom.includes(senderId);
}
