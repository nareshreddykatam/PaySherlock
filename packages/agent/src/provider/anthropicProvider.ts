import { AgentError } from "@paysherlock/types";
import { buildPlannerSystemPrompt } from "../prompts/planner.js";
import { buildNarratorSystemPrompt } from "../prompts/result.js";
import type { LLMProvider, Narration, NarrationFacts, PlanRequest, RawPlan } from "./types.js";

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  /** Override for tests; defaults to the real Anthropic API. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 1536;

interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
}

/**
 * Real Anthropic provider — a small hand-rolled client against the
 * Messages API (native fetch, forced tool-use for structured output),
 * mirroring the Razorpay adapter's approach: full control over the wire
 * format without an extra SDK dependency whose types we'd otherwise have
 * to trust blindly. See docs/decisions.
 *
 * Not exercised by the automated test suite (no network calls in tests) —
 * only reachable when AI_PROVIDER=anthropic and real credentials are
 * configured. See provider/factory.ts.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) throw new AgentError("AnthropicProvider requires an API key");
    if (!config.model) throw new AgentError("AnthropicProvider requires a model name");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async callWithForcedTool<T>(params: {
    system: string;
    userMessage: string;
    toolName: string;
    toolDescription: string;
    inputSchema: Record<string, unknown>;
  }): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: params.system,
          messages: [{ role: "user", content: params.userMessage }],
          tools: [
            {
              name: params.toolName,
              description: params.toolDescription,
              input_schema: params.inputSchema,
            },
          ],
          tool_choice: { type: "tool", name: params.toolName },
        }),
      });
    } catch (cause) {
      throw new AgentError("Network error calling the Anthropic API", { cause });
    }

    if (!response.ok) {
      const body = await response.text();
      throw new AgentError(`Anthropic API request failed with status ${response.status}: ${body}`);
    }

    const message = (await response.json()) as AnthropicMessageResponse;
    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse) {
      throw new AgentError("Anthropic response did not include the expected tool call");
    }
    return toolUse.input as T;
  }

  async plan(request: PlanRequest): Promise<RawPlan> {
    const result = await this.callWithForcedTool<Partial<RawPlan>>({
      system: buildPlannerSystemPrompt(request.toolCatalog, request.candidateHypothesisCatalog),
      userMessage:
        request.question + (request.context ? `\n\nAdditional context: ${request.context}` : ""),
      toolName: "submit_investigation_plan",
      toolDescription: "Submit the structured investigation plan.",
      inputSchema: {
        type: "object",
        properties: {
          objective: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string" },
                input: { type: "object" },
                rationale: { type: "string" },
              },
              required: ["tool"],
            },
          },
          candidateHypothesisIds: { type: "array", items: { type: "string" } },
        },
        required: ["objective", "steps", "candidateHypothesisIds"],
      },
    });

    return {
      objective: result.objective ?? `Investigate: ${request.question}`,
      steps: Array.isArray(result.steps) ? result.steps : [],
      candidateHypothesisIds: Array.isArray(result.candidateHypothesisIds)
        ? result.candidateHypothesisIds
        : [],
    };
  }

  async narrate(facts: NarrationFacts): Promise<Narration> {
    const result = await this.callWithForcedTool<Partial<Narration>>({
      system: buildNarratorSystemPrompt(),
      userMessage: JSON.stringify(facts),
      toolName: "submit_narration",
      toolDescription: "Submit the investigation summary and recommendations.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          recommendations: { type: "array", items: { type: "string" } },
        },
        required: ["summary", "recommendations"],
      },
    });

    return {
      summary: result.summary ?? "",
      recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
    };
  }
}
