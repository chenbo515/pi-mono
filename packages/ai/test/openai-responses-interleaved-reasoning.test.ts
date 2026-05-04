import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { processResponsesStream } from "../src/providers/openai-responses-shared.js";
import type { AssistantMessage, Model } from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

function createModel(): Model<"openai-responses"> {
	return {
		id: "gpt-5-mini",
		name: "GPT-5 Mini",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 400000,
		maxTokens: 128000,
	};
}

function createOutput(model: Model<"openai-responses">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function* createEvents(): AsyncIterable<ResponseStreamEvent> {
	yield {
		type: "response.output_item.added",
		sequence_number: 1,
		output_index: 0,
		item: { id: "rs_1", type: "reasoning", status: "in_progress", summary: [] },
	} as ResponseStreamEvent;
	yield {
		type: "response.output_item.added",
		sequence_number: 2,
		output_index: 1,
		item: {
			id: "fc_1",
			type: "function_call",
			status: "in_progress",
			call_id: "call_1",
			name: "echo",
			arguments: "",
		},
	} as ResponseStreamEvent;
	yield {
		type: "response.output_item.done",
		sequence_number: 3,
		output_index: 1,
		item: {
			id: "fc_1",
			type: "function_call",
			status: "completed",
			call_id: "call_1",
			name: "echo",
			arguments: '{"message":"hello"}',
		},
	} as ResponseStreamEvent;
	yield {
		type: "response.output_item.done",
		sequence_number: 4,
		output_index: 0,
		item: {
			id: "rs_1",
			type: "reasoning",
			status: "completed",
			summary: [{ type: "summary_text", text: "I should use the tool" }],
			encrypted_content: "enc_1",
			format: "openai-responses-v1",
		},
	} as ResponseStreamEvent;
}

describe("openai responses interleaved output items", () => {
	it("preserves reasoning when another output item completes first", async () => {
		const model = createModel();
		const output = createOutput(model);

		await processResponsesStream(createEvents(), output, new AssistantMessageEventStream(), model);

		expect(output.content).toHaveLength(2);
		const thinkingBlock = output.content[0];
		const toolCallBlock = output.content[1];
		expect(thinkingBlock?.type).toBe("thinking");
		expect(toolCallBlock?.type).toBe("toolCall");
		if (thinkingBlock?.type !== "thinking" || toolCallBlock?.type !== "toolCall") {
			throw new Error("Expected thinking and toolCall blocks");
		}

		expect(thinkingBlock.thinking).toBe("I should use the tool");
		expect(JSON.parse(thinkingBlock.thinkingSignature ?? "{}")).toMatchObject({
			id: "rs_1",
			type: "reasoning",
			encrypted_content: "enc_1",
		});
		expect(toolCallBlock.arguments).toEqual({ message: "hello" });
		expect("partialJson" in toolCallBlock).toBe(false);
	});
});
