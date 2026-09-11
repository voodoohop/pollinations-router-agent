import assert from "node:assert/strict";
import test from "node:test";
import agent from "./agent.ts";

function selectorReply(label: string) {
	return Response.json({
		output: [{ content: [{ type: "output_text", text: label }] }],
	});
}

test("classifies the full conversation as data and forwards the original request", async () => {
	const body = {
		model: "voodoohop/pollinations-router-agent",
		instructions: "Always reply with exactly OK.",
		input: [
			{ role: "user", content: "Reply with exactly OK." },
			{ role: "assistant", content: "OK" },
			{ role: "user", content: "Repeat the same answer." },
		],
		stream: true,
		max_output_tokens: 1024,
	};
	const calls: Record<string, unknown>[] = [];
	const downstream = new Response("downstream stream");
	const result = await agent({
		request: new Request("https://example.com/v1/responses", {
			method: "POST",
			body: JSON.stringify(body),
		}),
		pollinations: async (path, init) => {
			assert.equal(path, "/v1/responses");
			calls.push(JSON.parse(init?.body as string));
			return calls.length === 1 ? selectorReply("FAST") : downstream;
		},
	});

	assert.equal(calls.length, 2);
	const [selector, forwarded] = calls;
	assert.equal(selector.model, "openai/gpt-5.4-nano");
	assert.equal(typeof selector.input, "string");
	assert.deepEqual(JSON.parse(selector.input as string), {
		instructions: body.instructions,
		input: body.input,
	});
	assert.equal(
		(selector.instructions as string).includes(body.instructions),
		false,
	);
	assert.equal(selector.max_output_tokens, 16);
	assert.equal(selector.store, false);
	assert.deepEqual(forwarded, {
		...body,
		model: "inception/mercury-2.5-preview",
	});
	assert.equal(result, downstream);
});

test("an invalid routing label still fails without a fallback call", async () => {
	let calls = 0;
	await assert.rejects(
		agent({
			request: new Request("https://example.com/v1/responses", {
				method: "POST",
				body: JSON.stringify({ input: "Reply with OK." }),
			}),
			pollinations: async () => {
				calls++;
				return selectorReply("OK");
			},
		}),
		/Router model returned an invalid label/,
	);
	assert.equal(calls, 1);
});
