/**
 * Environment interface
 * These should be set as secrets via `wrangler secret put`
 */
declare global {
	interface Env {
		ALLOWED_TARGET_HOSTS?: string;
		DEBUG_REQUEST_LOGS?: string;
	}
}

export {};
