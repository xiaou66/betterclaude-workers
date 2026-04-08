import { isTargetHostAllowed, loadRuntimeConfig } from './config';
import { parseRoute } from './routes';
import type { AppContext, AppDependencies } from './types';

export async function handleRequest(context: AppContext, deps: AppDependencies): Promise<Response> {
	const url = new URL(context.request.url);
	const pathname = url.pathname;

	if (pathname === '/') {
		return new Response('BetterClaude Gateway. Use /claude/{host}/v1/messages', {
			status: 200,
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	if (pathname === '/health') {
		return new Response('OK', {
			status: 200,
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	const route = parseRoute(url);
	if (!route) {
		return new Response('Invalid endpoint. Required format: /claude/{host}/{path}', {
			status: 400,
			headers: { 'Content-Type': 'text/plain' },
		});
	}

	if (!route.targetPath.includes('v1/messages')) {
		return new Response(
			JSON.stringify({
				type: 'error',
				error: {
					type: 'forbidden',
					message: 'Invalid endpoint. Path must contain v1/messages',
				},
			}),
			{
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	const config = loadRuntimeConfig(context.env);
	if (!isTargetHostAllowed(route.targetHost, config)) {
		return new Response(
			JSON.stringify({
				type: 'error',
				error: {
					type: 'forbidden',
					message: 'Target host is not allowed',
				},
			}),
			{
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	return deps.proxyRequest(context.request, route);
}
