import type { AppContext } from '../../core/types';

export function createCloudflareAppContext(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): AppContext {
	const stringEnv = Object.fromEntries(
		Object.entries(env as unknown as Record<string, unknown>).filter(([, value]) => typeof value === 'string')
	) as Record<string, string | undefined>;

	return {
		request,
		platform: 'cloudflare',
		env: stringEnv,
		waitUntil: promise => ctx.waitUntil(promise),
	};
}
