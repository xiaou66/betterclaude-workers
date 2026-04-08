export interface AppContext {
	request: Request;
	platform: 'cloudflare' | 'edgeone';
	env: Record<string, string | undefined>;
	waitUntil?: (promise: Promise<unknown>) => void;
}

export interface RouteInfo {
	targetHost: string;
	targetPath: string;
	searchParams: string;
}

export interface AppDependencies {
	proxyRequest: (request: Request, route: RouteInfo) => Promise<Response>;
}
