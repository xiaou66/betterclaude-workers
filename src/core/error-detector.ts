export interface ErrorInfo {
	isError: boolean;
	orphanedIds: string[];
	provider: 'claude' | 'minimax' | null;
}

export async function detectOrphanedToolError(response: Response): Promise<ErrorInfo> {
	if (response.status !== 400) {
		return {
			isError: false,
			orphanedIds: [],
			provider: null,
		};
	}

	try {
		const body = await response.clone().text();
		const errorData = JSON.parse(body);
		const errorMessage = errorData?.error?.message || '';

		const claudeMatches = [
			...errorMessage.matchAll(/unexpected `tool_use_id` found in `tool_result` blocks: (toolu_\w+)/g),
		];
		if (claudeMatches.length > 0) {
			return {
				isError: true,
				orphanedIds: claudeMatches.map(match => match[1]),
				provider: 'claude',
			};
		}

		const minimaxMatches = [...errorMessage.matchAll(/tool result's tool id\(([^)]+)\) not found/g)];
		if (minimaxMatches.length > 0) {
			return {
				isError: true,
				orphanedIds: minimaxMatches.map(match => match[1]),
				provider: 'minimax',
			};
		}

		return {
			isError: false,
			orphanedIds: [],
			provider: null,
		};
	} catch {
		return {
			isError: false,
			orphanedIds: [],
			provider: null,
		};
	}
}
