import type { RouteInfo } from './types';

export function parseRoute(url: URL): RouteInfo | null {
	const match = url.pathname.match(/^\/claude\/([^/]+)\/(.*)$/);

	if (!match) {
		return null;
	}

	return {
		targetHost: match[1],
		targetPath: match[2] || '',
		searchParams: url.search,
	};
}
