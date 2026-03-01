import fs from "node:fs";
import path from "node:path";
import { AgentsError, ensure } from "./errors";
import {
  ProviderModelListFailure,
  ProviderModelListOptions,
  JsonObject,
  Model,
  ModelGenerateRequest,
  ModelGenerateResult,
  ProviderHandle,
  ProviderModelList,
  ProviderName,
  RequestedToolCall,
  Tool,
  ToolCallResult
} from "./types";

interface ProviderRuntimeEnv {
  processEnv: NodeJS.ProcessEnv;
  dotEnv: Record<string, string>;
}

interface ProviderRuntimeModelListResult {
  models: string[];
  failure?: ProviderModelListFailure;
}

interface ProviderEnvSpec {
  apiKey: string;
  baseUrl: string;
  model: string;
  modelList?: string;
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
    modelList: "AGENTS_OLLAMA_MODELS",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultApiKey: "ollama",
    requireApiKey: false
  },
  lmstudio: {
    apiKey: "AGENTS_LMSTUDIO_API_KEY",
    baseUrl: "AGENTS_LMSTUDIO_BASE_URL",
    model: "AGENTS_LMSTUDIO_MODEL",
    modelList: "AGENTS_LMSTUDIO_MODELS",
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

const PROVIDER_NAMES: ProviderName[] = [
  "openai",
  "ollama",
  "lmstudio",
  "gemini",
  "anthropic",
  "openrouter"
];
const MODEL_LIST_TIMEOUT_DEFAULT_MS = 2_000;

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
  private readonly runtimeEnv: ProviderRuntimeEnv;

  public constructor(name: ProviderName, runtimeEnv: ProviderRuntimeEnv) {
    this.name = name;
    this.runtimeEnv = runtimeEnv;
  }

  public getModel(modelName?: string): Model {
    const spec = PROVIDER_SPECS[this.name];
    const timeoutMs = parseTimeout(
      readConfigValue("AGENTS_REQUEST_TIMEOUT_MS", this.runtimeEnv)
    );
    const baseUrl = applyProviderBaseUrlSuffix(
      (
      readConfigValue(spec.baseUrl, this.runtimeEnv) ?? spec.defaultBaseUrl
      ).trim(),
      spec
    );
    const apiKey = (
      readConfigValue(spec.apiKey, this.runtimeEnv) ?? spec.defaultApiKey ?? ""
    ).trim();
    const resolvedModel = (
      modelName ??
      readConfigValue(spec.model, this.runtimeEnv) ??
      spec.defaultModel ??
      ""
    ).trim();

    ensure(baseUrl, "AGENTS-E-PROVIDER-CONFIG", `${spec.baseUrl} is required.`);
    ensure(resolvedModel, "AGENTS-E-PROVIDER-CONFIG", `${spec.model} is required.`);
    if (spec.requireApiKey) {
      ensure(apiKey, "AGENTS-E-PROVIDER-CONFIG", `${spec.apiKey} is required.`);
    }

    const headers: Record<string, string> = {};
    if (this.name === "openrouter") {
      const referer = readConfigValue(
        "AGENTS_OPENROUTER_HTTP_REFERER",
        this.runtimeEnv
      )?.trim();
      const title = readConfigValue(
        "AGENTS_OPENROUTER_X_TITLE",
        this.runtimeEnv
      )?.trim();
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

  public async listModels(options?: ProviderModelListOptions): Promise<ProviderModelList> {
    const resolved = resolveProviderModelListConfig(
      this.name,
      this.runtimeEnv,
      options
    );
    const runtimeResult = await fetchProviderModelList({
      provider: this.name,
      baseUrl: trimTrailingSlash(resolved.baseUrl),
      apiKey: resolved.apiKey,
      timeoutMs: resolved.timeoutMs
    });
    const runtimeModels = runtimeResult.models;

    if (runtimeModels.length > 0) {
      return {
        provider: this.name,
        models: runtimeModels,
        resolution: "runtime_api"
      };
    }

    if (resolved.models.length > 0) {
      return {
        provider: this.name,
        models: resolved.models,
        resolution: "configured",
        runtimeApiFailure: runtimeResult.failure
      };
    }

    if (resolved.defaultModel) {
      return {
        provider: this.name,
        models: [resolved.defaultModel],
        resolution: "default",
        runtimeApiFailure: runtimeResult.failure
      };
    }

    return {
      provider: this.name,
      models: [],
      resolution: "environment_dependent",
      runtimeApiFailure: runtimeResult.failure
    };
  }
}

export function getProvider(providerName?: ProviderName): ProviderHandle {
  const runtimeEnv = loadProviderRuntimeEnv(process.env);
  const raw =
    providerName ?? readConfigValue("AGENTS_MODEL_PROVIDER", runtimeEnv) ?? "openai";
  const normalized = raw.trim().toLowerCase();
  if (!isProviderName(normalized)) {
    throw new AgentsError(
      "AGENTS-E-PROVIDER-CONFIG",
      `Unsupported provider: ${raw}`
    );
  }

  return new EnvProviderHandle(normalized, runtimeEnv);
}

export function listProviders(): ProviderName[] {
  return [...PROVIDER_NAMES];
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

function parseTimeout(
  raw: string | undefined,
  defaults: { fallbackMs: number; minMs: number } = {
    fallbackMs: 60_000,
    minMs: 1_000
  }
): number {
  if (!raw) {
    return defaults.fallbackMs;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < defaults.minMs) {
    return defaults.fallbackMs;
  }
  return Math.floor(parsed);
}

function loadProviderRuntimeEnv(processEnv: NodeJS.ProcessEnv): ProviderRuntimeEnv {
  return {
    processEnv,
    dotEnv: loadDotEnvFile(path.join(process.cwd(), ".env"))
  };
}

function readConfigValue(
  key: string,
  runtimeEnv: ProviderRuntimeEnv
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(runtimeEnv.dotEnv, key)) {
    return runtimeEnv.dotEnv[key];
  }
  return runtimeEnv.processEnv[key];
}

function resolveListModelsTimeout(
  timeoutOverride: number | undefined,
  rawModelListTimeout: string | undefined,
  rawRequestTimeout: string | undefined
): number {
  if (typeof timeoutOverride === "number" && Number.isFinite(timeoutOverride)) {
    return timeoutOverride >= 200 ? Math.floor(timeoutOverride) : MODEL_LIST_TIMEOUT_DEFAULT_MS;
  }
  if (typeof rawModelListTimeout === "string") {
    return parseTimeout(rawModelListTimeout, {
      fallbackMs: MODEL_LIST_TIMEOUT_DEFAULT_MS,
      minMs: 200
    });
  }
  if (typeof rawRequestTimeout === "string") {
    return parseTimeout(rawRequestTimeout, {
      fallbackMs: MODEL_LIST_TIMEOUT_DEFAULT_MS,
      minMs: 200
    });
  }
  return MODEL_LIST_TIMEOUT_DEFAULT_MS;
}

function resolveProviderModelListConfig(
  provider: ProviderName,
  runtimeEnv: ProviderRuntimeEnv,
  options?: ProviderModelListOptions
): {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  models: string[];
  defaultModel: string;
} {
  const spec = PROVIDER_SPECS[provider];
  const directBaseUrl = readDirectStringOption(options?.baseUrl, options?.BASE_URL);
  const directApiKey = readDirectStringOption(options?.apiKey, options?.API_KEY);
  const directTimeoutMs = readDirectNumberOption(
    options?.timeoutMs,
    options?.TIMEOUT_MS
  );
  const baseUrl = applyProviderBaseUrlSuffix(
    (
    directBaseUrl ??
    readConfigValue(spec.baseUrl, runtimeEnv) ??
    spec.defaultBaseUrl
    ).trim(),
    spec
  );
  const apiKey = (
    directApiKey ??
    readConfigValue(spec.apiKey, runtimeEnv) ??
    spec.defaultApiKey ??
    ""
  ).trim();
  const timeoutMs = resolveListModelsTimeout(
    directTimeoutMs,
    readConfigValue("AGENTS_MODEL_LIST_TIMEOUT_MS", runtimeEnv),
    readConfigValue("AGENTS_REQUEST_TIMEOUT_MS", runtimeEnv)
  );
  const models = resolveModels(spec, runtimeEnv, options);
  const defaultModel = (spec.defaultModel ?? "").trim();

  return {
    baseUrl,
    apiKey,
    timeoutMs,
    models,
    defaultModel
  };
}

function resolveModels(
  spec: ProviderEnvSpec,
  runtimeEnv: ProviderRuntimeEnv,
  options?: ProviderModelListOptions
): string[] {
  const directModelsOption = readDirectStringArrayOption(
    options?.models,
    options?.MODELS
  );
  const directModelOption = readDirectStringOption(options?.model, options?.MODEL);
  if (Array.isArray(directModelsOption) || typeof directModelOption === "string") {
    const directModels = [
      ...normalizeModelNames(directModelsOption ?? []),
      ...(typeof directModelOption === "string"
        ? normalizeModelNames([directModelOption])
        : [])
    ];
    return unique(directModels);
  }

  const models: string[] = [];
  models.push(...resolveModelsFromConfig(runtimeEnv, spec));
  const single = readConfigValue(spec.model, runtimeEnv)?.trim() ?? "";
  if (single) {
    models.push(single);
  }

  return unique(models);
}

function normalizeModelNames(values: string[]): string[] {
  const models: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      models.push(trimmed);
    }
  }
  return models;
}

function resolveModelsFromConfig(
  runtimeEnv: ProviderRuntimeEnv,
  spec: ProviderEnvSpec
): string[] {
  const raw =
    (spec.modelList ? readConfigValue(spec.modelList, runtimeEnv) : undefined) ?? "";
  if (raw.trim().length === 0) {
    return [];
  }

  const models: string[] = [];
  for (const token of raw.split(/[,\n]/)) {
    const trimmed = token.trim();
    if (trimmed.length > 0) {
      models.push(trimmed);
    }
  }
  return unique(models);
}

async function fetchProviderModelList(options: {
  provider: ProviderName;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}): Promise<ProviderRuntimeModelListResult> {
  if (!options.baseUrl) {
    return {
      models: [],
      failure: {
        code: "network_error",
        message: "Model list baseUrl is empty."
      }
    };
  }

  const url = `${options.baseUrl}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(options.apiKey),
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        models: [],
        failure: {
          code: "http_error",
          message: `Model list request failed (${response.status} ${response.statusText}).`,
          status: response.status,
          statusText: response.statusText
        }
      };
    }
    const json = await response.json().catch(() => {
      return undefined;
    });
    if (typeof json === "undefined") {
      return {
        models: [],
        failure: {
          code: "invalid_payload",
          message: "Model list response is not valid JSON."
        }
      };
    }
    const models = parseProviderModelNames(json);
    if (models.length === 0) {
      return {
        models: [],
        failure: {
          code: "empty_response",
          message: "Model list response contained no models."
        }
      };
    }
    return { models };
  } catch (error) {
    const maybeError = error as { name?: string };
    if (maybeError?.name === "AbortError") {
      return {
        models: [],
        failure: {
          code: "timeout",
          message: `Model list request timed out after ${options.timeoutMs}ms.`
        }
      };
    }
    return {
      models: [],
      failure: {
        code: "network_error",
        message: "Model list request failed due to network/runtime error."
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseProviderModelNames(raw: unknown): string[] {
  const names: string[] = [];
  const payload = toRecord(raw);

  appendModelEntries(names, payload.data);
  appendModelEntries(names, payload.models);

  return unique(names);
}

function appendModelEntries(target: string[], value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const entryRaw of value) {
    if (typeof entryRaw === "string") {
      if (entryRaw.trim().length > 0) {
        target.push(entryRaw.trim());
      }
      continue;
    }

    const entry = toRecord(entryRaw);
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const model = typeof entry.model === "string" ? entry.model.trim() : "";

    if (id) {
      target.push(id);
      continue;
    }
    if (name) {
      target.push(name);
      continue;
    }
    if (model) {
      target.push(model);
    }
  }
}

function loadDotEnvFile(dotEnvPath: string): Record<string, string> {
  let content = "";
  try {
    content = fs.readFileSync(dotEnvPath, "utf8");
  } catch {
    return {};
  }

  const entries: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const parsed = parseDotEnvLine(line);
    if (!parsed) {
      continue;
    }
    entries[parsed.key] = parsed.value;
  }
  return entries;
}

function parseDotEnvLine(
  line: string
): { key: string; value: string } | undefined {
  const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
  const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) {
    return undefined;
  }
  const key = match[1];
  const value = parseDotEnvValue(match[2]);
  return { key, value };
}

function parseDotEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unquoted = trimmed.slice(1, -1);
    if (trimmed.startsWith("\"")) {
      return unquoted
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
    }
    return unquoted;
  }
  return trimmed;
}

function readDirectStringOption(
  primary: string | undefined,
  alias: string | undefined
): string | undefined {
  if (typeof primary === "string") {
    return primary;
  }
  if (typeof alias === "string") {
    return alias;
  }
  return undefined;
}

function readDirectNumberOption(
  primary: number | undefined,
  alias: number | undefined
): number | undefined {
  if (typeof primary === "number") {
    return primary;
  }
  if (typeof alias === "number") {
    return alias;
  }
  return undefined;
}

function readDirectStringArrayOption(
  primary: string[] | undefined,
  alias: string[] | undefined
): string[] | undefined {
  if (Array.isArray(primary)) {
    return primary;
  }
  if (Array.isArray(alias)) {
    return alias;
  }
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function applyProviderBaseUrlSuffix(
  rawBaseUrl: string,
  spec: ProviderEnvSpec
): string {
  const trimmedBaseUrl = rawBaseUrl.trim();
  if (!trimmedBaseUrl) {
    return trimmedBaseUrl;
  }

  const requiredSuffix = getRequiredBaseUrlSuffix(spec.defaultBaseUrl);
  if (!requiredSuffix) {
    return trimmedBaseUrl;
  }

  if (hasRequiredSuffix(trimmedBaseUrl, requiredSuffix)) {
    return trimmedBaseUrl;
  }

  const merged = `${trimTrailingSlash(trimmedBaseUrl)}${requiredSuffix}`;
  return merged;
}

function getRequiredBaseUrlSuffix(defaultBaseUrl: string): string {
  try {
    const defaultUrl = new URL(defaultBaseUrl);
    const pathname = trimTrailingSlash(defaultUrl.pathname);
    if (!pathname || pathname === "/") {
      return "";
    }
    return pathname.startsWith("/") ? pathname : `/${pathname}`;
  } catch {
    return "";
  }
}

function hasRequiredSuffix(baseUrl: string, requiredSuffix: string): boolean {
  const normalizedBase = trimTrailingSlash(baseUrl).toLowerCase();
  const normalizedSuffix = trimTrailingSlash(requiredSuffix).toLowerCase();
  return normalizedBase.endsWith(normalizedSuffix);
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
