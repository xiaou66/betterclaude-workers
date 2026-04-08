import { handleCloudflareRequest } from './adapters/cloudflare/entry';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		try {
			return await handleCloudflareRequest(request, env, ctx);
		} catch {
			return new Response('Bad Gateway', {
				status: 502,
				headers: { 'Content-Type': 'text/plain' },
			});
		}
	},
} satisfies ExportedHandler<Env>;
