import { retryWithCleanup } from './retry-handler';
import type { RouteInfo } from './types';

const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailers',
	'transfer-encoding',
	'upgrade',
	'host',
]);

const PROXY_MANAGED_HEADERS = new Set([
	'x-forwarded-for',
	'x-forwarded-proto',
	'x-forwarded-host',
	'x-real-ip',
	'true-client-ip',
	'cf-connecting-ip',
	'cf-connecting-ipv6',
	'cf-ipcountry',
	'cf-ray',
	'cf-visitor',
	'cf-worker',
	'x-request-id',
]);

export function buildUpstreamHeaders(request: Request, targetHost: string): Headers {
	const headers = new Headers();

	for (const [key, value] of request.headers.entries()) {
		const lowerKey = key.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(lowerKey) || PROXY_MANAGED_HEADERS.has(lowerKey)) {
			continue;
		}

		headers.set(key, value);
	}

	headers.set('Host', targetHost);

	const clientIp = request.headers.get('CF-Connecting-IP') || '';
	const clientIpv6 = request.headers.get('CF-Connecting-IPv6') || '';

	if (clientIp) {
		const originalXff = request.headers.get('X-Forwarded-For');
		headers.set('X-Forwarded-For', originalXff ? `${originalXff}, ${clientIp}` : clientIp);
		headers.set('X-Real-IP', clientIp);
		headers.set('True-Client-IP', clientIp);
		headers.set('CF-Connecting-IP', clientIp);
	}

	if (clientIpv6) {
		headers.set('CF-Connecting-IPv6', clientIpv6);
	}

	const originalHost = request.headers.get('Host') || '';
	if (originalHost) {
		headers.set('X-Forwarded-Host', originalHost);
	}

	const cfVisitor = request.headers.get('CF-Visitor');
	let originalProto = 'https';
	if (cfVisitor) {
		try {
			originalProto = JSON.parse(cfVisitor).scheme || 'https';
		} catch {
			originalProto = 'https';
		}
	}
	headers.set('X-Forwarded-Proto', originalProto);

	const cfCountry = request.headers.get('CF-IPCountry');
	if (cfCountry) {
		headers.set('CF-IPCountry', cfCountry);
	}

	const requestId = request.headers.get('X-Request-ID') || request.headers.get('X-Correlation-ID') || crypto.randomUUID();
	headers.set('X-Request-ID', requestId);
	headers.set('X-Correlation-ID', requestId);

	return headers;
}

export async function proxyRequest(request: Request, route: RouteInfo): Promise<Response> {
	const targetUrl = `https://${route.targetHost}/${route.targetPath}${route.searchParams}`;
	const headers = buildUpstreamHeaders(request, route.targetHost);

	if (request.method === 'GET' || request.method === 'HEAD') {
		return fetch(targetUrl, {
			method: request.method,
			headers,
		});
	}

	const contentType = request.headers.get('Content-Type') || '';
	const looksLikeJson =
		!contentType ||
		contentType.includes('application/json') ||
		contentType.includes('+json') ||
		contentType.includes('text/json');

	if (!looksLikeJson) {
		return fetch(targetUrl, {
			method: request.method,
			headers,
			body: request.body,
			// @ts-expect-error duplex is valid at runtime
			duplex: 'half',
		});
	}

	const bodyText = await request.text();

	try {
		const body = JSON.parse(bodyText);

		if (Array.isArray(body.messages)) {
			return retryWithCleanup(request, targetUrl, headers, {
				text: bodyText,
				json: body,
			});
		}
	} catch {
		return fetch(targetUrl, {
			method: request.method,
			headers,
			body: bodyText,
			// @ts-expect-error duplex is valid at runtime
			duplex: 'half',
		});
	}

	return fetch(targetUrl, {
		method: request.method,
		headers,
		body: bodyText,
		// @ts-expect-error duplex is valid at runtime
		duplex: 'half',
	});
}
