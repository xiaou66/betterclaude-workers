import { detectOrphanedToolError } from './error-detector';
import { detectAndRemoveOrphanedToolResults, type Message } from './proactive-cleanup';
import { isStreamingResponse } from './streaming-handler';

async function makeApiCall(
	request: Request,
	targetUrl: string,
	headers: Headers,
	body: string
): Promise<Response> {
	return fetch(targetUrl, {
		method: request.method,
		headers,
		body,
		// @ts-expect-error duplex is valid at runtime
		duplex: 'half',
	});
}

function removeOrphanedToolResult(messages: Message[], toolUseId: string): Message[] {
	const orphanedIdsSet = new Set([toolUseId]);
	const cleanedMessages = structuredClone(messages);

	for (const message of cleanedMessages) {
		message.content = message.content.filter(block => {
			if (block.type === 'tool_result' && block.tool_use_id) {
				return !orphanedIdsSet.has(block.tool_use_id);
			}
			return true;
		});
	}

	return cleanedMessages;
}

export async function retryWithCleanup(
	request: Request,
	targetUrl: string,
	headers: Headers,
	providedBody?: { text: string; json?: unknown }
): Promise<Response> {
	const bodyText = providedBody?.text ?? (await request.text());
	let body: any = providedBody?.json;

	if (body === undefined) {
		body = JSON.parse(bodyText);
	}

	if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
		return makeApiCall(request, targetUrl, headers, bodyText);
	}

	const cleanupResult = detectAndRemoveOrphanedToolResults(body.messages);
	body.messages = cleanupResult.cleanedMessages;

	const firstResponse = await makeApiCall(request, targetUrl, headers, JSON.stringify(body));
	if (firstResponse.ok || isStreamingResponse(firstResponse) || firstResponse.status !== 400) {
		return firstResponse;
	}

	const errorInfo = await detectOrphanedToolError(firstResponse);
	if (!errorInfo.isError || errorInfo.orphanedIds.length === 0) {
		return firstResponse;
	}

	body.messages = removeOrphanedToolResult(body.messages, errorInfo.orphanedIds[0]);

	return makeApiCall(request, targetUrl, headers, JSON.stringify(body));
}
