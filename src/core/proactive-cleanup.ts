export interface ContentBlock {
	type: 'text' | 'tool_use' | 'tool_result';
	text?: string;
	id?: string;
	tool_use_id?: string;
	name?: string;
	input?: unknown;
	content?: string | ContentBlock[];
}

export interface Message {
	role: 'user' | 'assistant' | 'system';
	content: ContentBlock[];
}

export interface CleanupResult {
	cleanedMessages: Message[];
	removedIds: string[];
	hadOrphans: boolean;
}

export function detectAndRemoveOrphanedToolResults(messages: Message[]): CleanupResult {
	const validToolUseIds = new Set<string>();

	for (const message of messages) {
		for (const block of message.content) {
			if (block.type === 'tool_use' && block.id) {
				validToolUseIds.add(block.id);
			}
		}
	}

	const orphanedIds: string[] = [];

	for (const message of messages) {
		for (const block of message.content) {
			if (block.type === 'tool_result' && block.tool_use_id && !validToolUseIds.has(block.tool_use_id)) {
				orphanedIds.push(block.tool_use_id);
			}
		}
	}

	if (orphanedIds.length === 0) {
		return {
			cleanedMessages: messages,
			removedIds: [],
			hadOrphans: false,
		};
	}

	const orphanedIdsSet = new Set(orphanedIds);
	const cleanedMessages = structuredClone(messages);

	for (const message of cleanedMessages) {
		message.content = message.content.filter(block => {
			if (block.type === 'tool_result' && block.tool_use_id) {
				return !orphanedIdsSet.has(block.tool_use_id);
			}
			return true;
		});
	}

	return {
		cleanedMessages,
		removedIds: orphanedIds,
		hadOrphans: true,
	};
}
