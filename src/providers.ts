import { AgentsError, ensure } from "./errors";
import {
  JsonObject,
  Model,
  ModelGenerateRequest,
  ModelGenerateResult,
  ProviderHandle,
  ProviderName,
  RequestedToolCall,
  Tool,
  ToolCallResult
} from "./types";

interface ProviderEnvSpec {
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultBaseUrl: string;
  defaultModel?: string;
  defaultApiKey?: string;
  requireApiKey: boolean;
}

interface ChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
  };
}

interface ChatCompletionPayload {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  tools?: ChatCompletionTool[];
  tool_choice?: "auto";
  stream: boolean;
}

const PROVIDER_SPECS: Record<ProviderName, ProviderEnvSpec> = {
  openai: {
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
    model: "AGENTS_OPENAI_MODEL",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    requireApiKey: true
  },
  ollama: {
    apiKey: "AGENTS_OLLAMA_API_KEY",
    baseUrl: "AGENTS_OLLAMA_BASE_URL",
    model: "AGENTS_OLLAMA_MODEL",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultApiKey: "ollama",
    requireApiKey: false
  },
  lmstudio: {
    apiKey: "AGENTS_LMSTUDIO_API_KEY",
    baseUrl: "AGENTS_LMSTUDIO_BASE_URL",
    model: "AGENTS_LMSTUDIO_MODEL",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    defaultApiKey: "lmstudio",
    requireApiKey: false
  },
  gemini: {
    apiKey: "AGENTS_GEMINI_API_KEY",
    baseUrl: "AGENTS_GEMINI_BASE_URL",
    model: "AGENTS_GEMINI_MODEL",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    requireApiKey: true
  },
  anthropic: {
    apiKey: "AGENTS_ANTHROPIC_API_KEY",
    baseUrl: "AGENTS_ANTHROPIC_BASE_URL",
    model: "AGENTS_ANTHROPIC_MODEL",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    requireApiKey: true
  },
  openrouter: {
    apiKey: "AGENTS_OPENROUTER_API_KEY",
    baseUrl: "AGENTS_OPENROUTER_BASE_URL",
    model: "AGENTS_OPENROUTER_MODEL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requireApiKey: true
  }
};

class CompatChatCompletionModel implements Model {
  public readonly provider: ProviderName;
  public readonly name: string;
  public readonly baseUrl: string;
  public readonly timeoutMs: number;
  public readonly headers?: Record<string, string>;
  private readonly apiKey: string;

  public constructor(options: {
    provider: ProviderName;
    name: string;
    baseUrl: string;
    timeoutMs: number;
    apiKey: string;
    headers?: Record<string, string>;
  }) {
    this.provider = options.provider;
    this.name = options.name;
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs;
    this.apiKey = options.apiKey;
    this.headers = options.headers;
  }

  public async generate(request: ModelGenerateRequest): Promise<ModelGenerateResult> {
    const payload = buildChatCompletionPayload(this.name, request);
    const response = await this.postChatCompletions(payload);
    if (payload.stream) {
      return parseStreamingChatCompletion(response);
    }

    const json = await response.json().catch((error) => {
      throw new AgentsError(
        "AGENTS-E-PROVIDER-RUNTIME",
        `Invalid JSON response from ${this.provider}.`,
        error
      );
    });
    return parseChatCompletion(json);
  }

  private async postChatCompletions(payload: ChatCompletionPayload): Promise<Response> {
    const url = `${this.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...buildHeaders(this.apiKey),
          ...(this.headers ?? {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await safeReadText(response);
        throw new AgentsError(
          "AGENTS-E-PROVIDER-RUNTIME",
          `Provider request failed (${response.status} ${response.statusText}). ${body}`.trim()
        );
      }

      return response;
    } catch (error) {
      if (error instanceof AgentsError) {
        throw error;
      }
      throw new AgentsError(
        "AGENTS-E-PROVIDER-RUNTIME",
        `Provider request failed for ${this.provider}.`,
        error
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

class EnvProviderHandle implements ProviderHandle {
  public readonly name: ProviderName;
  private readonly env: NodeJS.ProcessEnv;

  public constructor(name: ProviderName, env: NodeJS.ProcessEnv) {
    this.name = name;
    this.env = env;
  }

  public getModel(modelName?: string): Model {
    const spec = PROVIDER_SPECS[this.name];
    const timeoutMs = parseTimeout(this.env.AGENTS_REQUEST_TIMEOUT_MS);
    const baseUrl = (this.env[spec.baseUrl] ?? spec.defaultBaseUrl).trim();
    const apiKey = (this.env[spec.apiKey] ?? spec.defaultApiKey ?? "").trim();
    const resolvedModel = (modelName ?? this.env[spec.model] ?? spec.defaultModel ?? "").trim();

    ensure(baseUrl, "AGENTS-E-PROVIDER-CONFIG", `${spec.baseUrl} is required.`);
    ensure(resolvedModel, "AGENTS-E-PROVIDER-CONFIG", `${spec.model} is required.`);
    if (spec.requireApiKey) {
      ensure(apiKey, "AGENTS-E-PROVIDER-CONFIG", `${spec.apiKey} is required.`);
    }

    const headers: Record<string, string> = {};
    if (this.name === "openrouter") {
      const referer = this.env.AGENTS_OPENROUTER_HTTP_REFERER?.trim();
      const title = this.env.AGENTS_OPENROUTER_X_TITLE?.trim();
      if (referer) {
        headers["HTTP-Referer"] = referer;
      }
      if (title) {
        headers["X-Title"] = title;
      }
    }

    return new CompatChatCompletionModel({
      provider: this.name,
      name: resolvedModel,
      baseUrl: trimTrailingSlash(baseUrl),
      timeoutMs,
      apiKey,
      headers: Object.keys(headers).length > 0 ? headers : undefined
    });
  }
}

export function getProvider(providerName?: ProviderName): ProviderHandle {
  const raw = providerName ?? process.env.AGENTS_MODEL_PROVIDER ?? "openai";
  const normalized = raw.trim().toLowerCase();
  if (!isProviderName(normalized)) {
    throw new AgentsError(
      "AGENTS-E-PROVIDER-CONFIG",
      `Unsupported provider: ${raw}`
    );
  }

  return new EnvProviderHandle(normalized, process.env);
}

function isProviderName(value: string): value is ProviderName {
  return (
    value === "openai" ||
    value === "ollama" ||
    value === "lmstudio" ||
    value === "gemini" ||
    value === "anthropic" ||
    value === "openrouter"
  );
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) {
    return 60_000;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    return 60_000;
  }
  return Math.floor(parsed);
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function buildChatCompletionPayload(model: string, request: ModelGenerateRequest): ChatCompletionPayload {
  const messages: ChatCompletionPayload["messages"] = [
    {
      role: "system",
      content: request.agent.instructions
    },
    {
      role: "user",
      content: request.inputText
    },
    ...buildToolContextMessages(request.toolCalls)
  ];

  const tools = request.agent.tools.map(toChatCompletionTool);
  const payload: ChatCompletionPayload = {
    model,
    messages,
    stream: request.stream === true
  };

  if (tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }
  return payload;
}

function toChatCompletionTool(tool: Tool): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object", additionalProperties: true }
    }
  };
}

function buildToolContextMessages(toolCalls: ToolCallResult[]): ChatCompletionPayload["messages"] {
  if (toolCalls.length === 0) {
    return [];
  }

  const summary = toolCalls
    .map((toolCall, index) => {
      return [
        `#${index + 1}`,
        `${toolCall.tool_name}`,
        `kind=${toolCall.tool_kind}`,
        `args=${safeJson(toolCall.args)}`,
        `output=${safeJson(toolCall.output)}`
      ].join(" ");
    })
    .join("\n");

  return [
    {
      role: "system",
      content: `Previous tool results:\n${summary}`
    }
  ];
}

function parseChatCompletion(raw: unknown): ModelGenerateResult {
  const data = toRecord(raw);
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const firstChoice = toRecord(choices[0]);
  const message = toRecord(firstChoice.message);
  ensure(
    Object.keys(message).length > 0,
    "AGENTS-E-PROVIDER-RUNTIME",
    "Invalid Chat Completions response: choices[0].message is missing."
  );

  const outputText = extractContentText(message.content);
  const toolCalls = parseToolCalls(message.tool_calls);
  return {
    outputText: outputText.length > 0 ? outputText : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    raw
  };
}

async function parseStreamingChatCompletion(response: Response): Promise<ModelGenerateResult> {
  ensure(
    response.body,
    "AGENTS-E-PROVIDER-RUNTIME",
    "Streaming response does not include a body."
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  const toolCalls = new Map<number, { name: string; argsText: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.remainder;

    for (const chunk of parsed.payloads) {
      if (chunk === "[DONE]") {
        continue;
      }

      let eventData: unknown;
      try {
        eventData = JSON.parse(chunk);
      } catch {
        continue;
      }

      const data = toRecord(eventData);
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const choice = toRecord(choices[0]);
      const delta = toRecord(choice.delta);

      if (typeof delta.content === "string") {
        outputText += delta.content;
      }

      const deltaToolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const entryRaw of deltaToolCalls) {
        const entry = toRecord(entryRaw);
        const index = typeof entry.index === "number" ? entry.index : 0;
        const fn = toRecord(entry.function);
        const bufferEntry = toolCalls.get(index) ?? { name: "", argsText: "" };

        if (typeof fn.name === "string" && fn.name.length > 0) {
          bufferEntry.name = fn.name;
        }
        if (typeof fn.arguments === "string" && fn.arguments.length > 0) {
          bufferEntry.argsText += fn.arguments;
        }
        toolCalls.set(index, bufferEntry);
      }
    }
  }

  const requestedToolCalls = materializeToolCalls(toolCalls);
  return {
    outputText: outputText.length > 0 ? outputText : undefined,
    toolCalls: requestedToolCalls.length > 0 ? requestedToolCalls : undefined
  };
}

function parseSseBuffer(buffer: string): { payloads: string[]; remainder: string } {
  const lines = buffer.split(/\r?\n/);
  const payloads: string[] = [];
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    payloads.push(trimmed.slice(5).trim());
  }

  return { payloads, remainder };
}

function parseToolCalls(value: unknown): RequestedToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const requested: RequestedToolCall[] = [];
  for (const entryRaw of value) {
    const entry = toRecord(entryRaw);
    const fn = toRecord(entry.function);
    if (typeof fn.name !== "string" || fn.name.length === 0) {
      continue;
    }
    requested.push({
      toolName: fn.name,
      args: parseArgs(fn.arguments)
    });
  }
  return requested;
}

function materializeToolCalls(
  items: Map<number, { name: string; argsText: string }>
): RequestedToolCall[] {
  const indexed = [...items.entries()].sort((left, right) => left[0] - right[0]);
  const requested: RequestedToolCall[] = [];

  for (const [, value] of indexed) {
    if (!value.name) {
      continue;
    }
    requested.push({
      toolName: value.name,
      args: parseArgs(value.argsText)
    });
  }
  return requested;
}

function parseArgs(raw: unknown): JsonObject {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isJsonObject(parsed)) {
      return parsed;
    }
  } catch {
    return {};
  }

  return {};
}

function extractContentText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (!Array.isArray(raw)) {
    return "";
  }

  const parts: string[] = [];
  for (const entryRaw of raw) {
    const entry = toRecord(entryRaw);
    if (typeof entry.text === "string") {
      parts.push(entry.text);
    }
  }
  return parts.join("");
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "\"[unserializable]\"";
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 1_000);
  } catch {
    return "";
  }
}
