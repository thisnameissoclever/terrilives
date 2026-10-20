/**
 * Problems the player can see, written to the console with enough detail to
 * trace them. Every failure that reaches a status line also reaches here, so
 * an error on screen is never silent in the console. Routine reports use
 * console.debug directly.
 */
export type LogDetails = Readonly<Record<string, unknown>>;

const PREFIX = '[Natural Causes]';

export function logError(area: string, message: string, details: LogDetails = {}): void {
  console.error(`${PREFIX} ${area}: ${message}`, details);
}

export function logWarning(area: string, message: string, details: LogDetails = {}): void {
  console.warn(`${PREFIX} ${area}: ${message}`, details);
}
