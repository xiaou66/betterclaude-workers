/**
 * Shared runtime environment variable names.
 * Cloudflare reads them from Wrangler-provided bindings.
 * EdgeOne and ESA read equivalent string values from their own runtime environment.
 */
declare global {
	interface Env {
		ALLOWED_TARGET_HOSTS?: string;
		DEBUG_REQUEST_LOGS?: string;
	}
}

export {};
