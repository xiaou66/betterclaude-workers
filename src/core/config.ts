export interface RuntimeConfig {
	allowedTargetHosts: Set<string>;
	debugRequestLogs: boolean;
}

function parseAllowedTargetHosts(value: string | undefined): Set<string> {
	if (!value) {
		return new Set();
	}

	return new Set(
		value
			.split(',')
			.map(host => host.trim().toLowerCase())
			.filter(Boolean)
	);
}

export function loadRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
	return {
		allowedTargetHosts: parseAllowedTargetHosts(env.ALLOWED_TARGET_HOSTS),
		debugRequestLogs: env.DEBUG_REQUEST_LOGS === 'true',
	};
}

export function isTargetHostAllowed(host: string, config: RuntimeConfig): boolean {
	if (config.allowedTargetHosts.size === 0) {
		return true;
	}

	return config.allowedTargetHosts.has(host.toLowerCase());
}
