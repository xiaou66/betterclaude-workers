export function isStreamingResponse(response: Response): boolean {
	const contentType = response.headers.get('Content-Type') || '';
	const transferEncoding = response.headers.get('Transfer-Encoding') || '';

	return contentType.includes('text/event-stream') || transferEncoding.includes('chunked');
}
