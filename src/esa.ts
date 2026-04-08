import { handleEsaRequest } from './adapters/esa/entry';

function readEsaEnv(): Record<string, string | undefined> {
	const processLike = globalThis as typeof globalThis & {
		process?: {
			env?: Record<string, unknown>;
		};
	};

	return Object.fromEntries(
		Object.entries(processLike.process?.env ?? {}).filter(([, value]) => typeof value === 'string')
	) as Record<string, string | undefined>;
}

export default {
	async fetch(request: Request): Promise<Response> {
		try {
			return await handleEsaRequest(request, readEsaEnv());
		} catch {
			return new Response('Bad Gateway', {
				status: 502,
				headers: { 'Content-Type': 'text/plain' },
			});
		}
	},
};
