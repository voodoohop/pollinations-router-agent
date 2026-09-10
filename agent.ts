type AgentContext = {
	request: Request;
	pollinations: (path: string, init?: RequestInit) => Promise<Response>;
};

type ResponsesRequest = Record<string, unknown> & {
	input: string | Array<unknown>;
	instructions?: string | null;
};

const ROUTER_MODEL = "openai/gpt-5-nano";
const MODELS = {
	FAST: "inception/mercury-2.5-preview",
	BALANCED: "google/gemini-3.8-flash",
	DEEP: "x-ai/grok-4.3",
} as const;

const ROUTER_INSTRUCTIONS = `Choose the cheapest model that can handle the request well.
Reply with exactly one label and nothing else:
FAST — simple text-only questions, extraction, rewriting, or short summaries.
BALANCED — normal coding, analysis, planning, or any request with images, audio, or video.
DEEP — difficult text or image reasoning, architecture, research synthesis, or unusually complex work.`;

function outputText(response: unknown): string {
	if (!response || typeof response !== "object") return "";
	const output = (response as { output?: unknown }).output;
	if (!Array.isArray(output)) return "";

	return output
		.flatMap((item) =>
			item && typeof item === "object" && Array.isArray(item.content)
				? item.content
				: [],
		)
		.filter(
			(part) =>
				part &&
				typeof part === "object" &&
				part.type === "output_text" &&
				typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("");
}

async function selectModel(
	request: ResponsesRequest,
	pollinations: AgentContext["pollinations"],
): Promise<string> {
	const response = await pollinations("/v1/responses", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: ROUTER_MODEL,
			instructions: request.instructions
				? `${ROUTER_INSTRUCTIONS}\n\nDownstream instructions:\n${request.instructions}`
				: ROUTER_INSTRUCTIONS,
			input: request.input,
			max_output_tokens: 16,
			reasoning: { effort: "none" },
			store: false,
		}),
	});
	if (!response.ok) return MODELS.BALANCED;

	const label = outputText(await response.json())
		.trim()
		.toUpperCase() as keyof typeof MODELS;
	return MODELS[label] ?? MODELS.BALANCED;
}

export default async function agent({
	request,
	pollinations,
}: AgentContext): Promise<Response> {
	const body = (await request.json()) as ResponsesRequest;
	const model = await selectModel(body, pollinations);

	return pollinations("/v1/responses", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ...body, model }),
	});
}
