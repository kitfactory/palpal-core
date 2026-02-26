import { AgentsError, ensure } from "./errors";
import { Model, ModelGenerateRequest, ProviderHandle, ProviderName } from "./types";

interface ProviderEnvSpec {
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultBaseUrl: string;
  defaultModel?: string;
  defaultApiKey?: string;
  requireApiKey: boolean;
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

  public async generate(request: ModelGenerateRequest): Promise<{ outputText: string }> {
    const toolSummary =
      request.toolCalls.length === 0 ? "no-tools" : `${request.toolCalls.length}-tools`;
    const text = `[${this.provider}/${this.name}/${toolSummary}] ${request.inputText}`;
    void this.apiKey;
    return { outputText: text };
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
