import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AgentsError, getProvider, listProviders } from "../src/index";
import { Tool } from "../src/types";

const DOT_ENV_PATH = path.join(process.cwd(), ".env");

async function withDotEnv(
  contents: string,
  run: () => Promise<void> | void
): Promise<void> {
  const existed = fs.existsSync(DOT_ENV_PATH);
  const original = existed ? fs.readFileSync(DOT_ENV_PATH, "utf8") : "";
  fs.writeFileSync(DOT_ENV_PATH, contents, "utf8");
  try {
    await run();
  } finally {
    if (existed) {
      fs.writeFileSync(DOT_ENV_PATH, original, "utf8");
    } else {
      fs.rmSync(DOT_ENV_PATH, { force: true });
    }
  }
}

test("getProvider().getModel() resolves from provider env", () => {
  const oldProvider = process.env.AGENTS_MODEL_PROVIDER;
  const oldModel = process.env.AGENTS_OLLAMA_MODEL;
  const oldBaseUrl = process.env.AGENTS_OLLAMA_BASE_URL;
  const oldTimeout = process.env.AGENTS_REQUEST_TIMEOUT_MS;

  process.env.AGENTS_MODEL_PROVIDER = "ollama";
  process.env.AGENTS_OLLAMA_MODEL = "gpt-oss-20b";
  process.env.AGENTS_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
  process.env.AGENTS_REQUEST_TIMEOUT_MS = "45000";

  const model = getProvider().getModel();
  assert.equal(model.provider, "ollama");
  assert.equal(model.name, "gpt-oss-20b");
  assert.equal(model.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(model.timeoutMs, 45_000);

  process.env.AGENTS_MODEL_PROVIDER = oldProvider;
  process.env.AGENTS_OLLAMA_MODEL = oldModel;
  process.env.AGENTS_OLLAMA_BASE_URL = oldBaseUrl;
  process.env.AGENTS_REQUEST_TIMEOUT_MS = oldTimeout;
});

test("openrouter headers are wired from env", () => {
  const oldApiKey = process.env.AGENTS_OPENROUTER_API_KEY;
  const oldModel = process.env.AGENTS_OPENROUTER_MODEL;
  const oldReferer = process.env.AGENTS_OPENROUTER_HTTP_REFERER;
  const oldTitle = process.env.AGENTS_OPENROUTER_X_TITLE;

  process.env.AGENTS_OPENROUTER_API_KEY = "test-key";
  process.env.AGENTS_OPENROUTER_MODEL = "openrouter/test-model";
  process.env.AGENTS_OPENROUTER_HTTP_REFERER = "https://example.com";
  process.env.AGENTS_OPENROUTER_X_TITLE = "palpal-core-test";

  const model = getProvider("openrouter").getModel();
  assert.equal(model.provider, "openrouter");
  assert.equal(model.headers?.["HTTP-Referer"], "https://example.com");
  assert.equal(model.headers?.["X-Title"], "palpal-core-test");

  process.env.AGENTS_OPENROUTER_API_KEY = oldApiKey;
  process.env.AGENTS_OPENROUTER_MODEL = oldModel;
  process.env.AGENTS_OPENROUTER_HTTP_REFERER = oldReferer;
  process.env.AGENTS_OPENROUTER_X_TITLE = oldTitle;
});

test("provider validation fails when required api key is missing", () => {
  const oldApiKey = process.env.OPENAI_API_KEY;
  const oldModel = process.env.AGENTS_OPENAI_MODEL;

  delete process.env.OPENAI_API_KEY;
  process.env.AGENTS_OPENAI_MODEL = "gpt-4.1-mini";

  assert.throws(() => getProvider("openai").getModel(), (error: unknown) => {
    assert.ok(error instanceof AgentsError);
    assert.equal(error.code, "AGENTS-E-PROVIDER-CONFIG");
    return true;
  });

  process.env.OPENAI_API_KEY = oldApiKey;
  process.env.AGENTS_OPENAI_MODEL = oldModel;
});

test("timeout falls back to default when AGENTS_REQUEST_TIMEOUT_MS is invalid", () => {
  const oldModel = process.env.AGENTS_OLLAMA_MODEL;
  const oldTimeout = process.env.AGENTS_REQUEST_TIMEOUT_MS;

  process.env.AGENTS_OLLAMA_MODEL = "gpt-oss-20b";
  process.env.AGENTS_REQUEST_TIMEOUT_MS = "invalid";

  const model = getProvider("ollama").getModel();
  assert.equal(model.timeoutMs, 60_000);

  process.env.AGENTS_OLLAMA_MODEL = oldModel;
  process.env.AGENTS_REQUEST_TIMEOUT_MS = oldTimeout;
});

test("getProvider uses .env before process.env when provider is omitted", async () => {
  const oldProvider = process.env.AGENTS_MODEL_PROVIDER;
  const oldModel = process.env.AGENTS_OLLAMA_MODEL;

  process.env.AGENTS_MODEL_PROVIDER = "openai";
  process.env.AGENTS_OLLAMA_MODEL = "dotenv-first-model";

  try {
    await withDotEnv(
      [
        "AGENTS_MODEL_PROVIDER=ollama",
        "AGENTS_OLLAMA_MODEL=dotenv-first-model"
      ].join("\n"),
      () => {
        const provider = getProvider();
        assert.equal(provider.name, "ollama");
      }
    );
  } finally {
    process.env.AGENTS_MODEL_PROVIDER = oldProvider;
    process.env.AGENTS_OLLAMA_MODEL = oldModel;
  }
});

test("getModel resolves with precedence direct > .env > process.env", async () => {
  const oldModel = process.env.AGENTS_OLLAMA_MODEL;
  const oldBaseUrl = process.env.AGENTS_OLLAMA_BASE_URL;

  process.env.AGENTS_OLLAMA_MODEL = "env-model";
  process.env.AGENTS_OLLAMA_BASE_URL = "http://env-host/v1";

  try {
    await withDotEnv(
      [
        "AGENTS_OLLAMA_MODEL=dotenv-model",
        "AGENTS_OLLAMA_BASE_URL=http://dotenv-host/v1"
      ].join("\n"),
      () => {
        const fromDotEnv = getProvider("ollama").getModel();
        assert.equal(fromDotEnv.name, "dotenv-model");
        assert.equal(fromDotEnv.baseUrl, "http://dotenv-host/v1");

        const fromDirect = getProvider("ollama").getModel("direct-model");
        assert.equal(fromDirect.name, "direct-model");
        assert.equal(fromDirect.baseUrl, "http://dotenv-host/v1");
      }
    );
  } finally {
    process.env.AGENTS_OLLAMA_MODEL = oldModel;
    process.env.AGENTS_OLLAMA_BASE_URL = oldBaseUrl;
  }
});

test("provider listModels calls ollama models API and falls back to environment_dependent", async () => {
  const oldModel = process.env.AGENTS_OLLAMA_MODEL;
  const oldModels = process.env.AGENTS_OLLAMA_MODELS;
  const oldBaseUrl = process.env.AGENTS_OLLAMA_BASE_URL;
  const oldTimeout = process.env.AGENTS_REQUEST_TIMEOUT_MS;
  const oldFetch = globalThis.fetch;

  try {
    delete process.env.AGENTS_OLLAMA_MODEL;
    delete process.env.AGENTS_OLLAMA_MODELS;
    process.env.AGENTS_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
    process.env.AGENTS_REQUEST_TIMEOUT_MS = "1000";

    let calledUrl = "";
    globalThis.fetch = async (url) => {
      calledUrl = String(url);
      return new Response("{}", { status: 503 });
    };

    const modelList = await getProvider("ollama").listModels();
    assert.equal(modelList.provider, "ollama");
    assert.equal(modelList.resolution, "environment_dependent");
    assert.deepEqual(modelList.models, []);
    assert.equal(modelList.runtimeApiFailure?.code, "http_error");
    assert.equal(modelList.runtimeApiFailure?.status, 503);
    assert.equal(calledUrl, "http://127.0.0.1:11434/v1/models");
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_OLLAMA_MODEL = oldModel;
    process.env.AGENTS_OLLAMA_MODELS = oldModels;
    process.env.AGENTS_OLLAMA_BASE_URL = oldBaseUrl;
    process.env.AGENTS_REQUEST_TIMEOUT_MS = oldTimeout;
  }
});

test("provider listModels returns runtime_api values for ollama when API succeeds", async () => {
  const oldModel = process.env.AGENTS_OLLAMA_MODEL;
  const oldModels = process.env.AGENTS_OLLAMA_MODELS;
  const oldBaseUrl = process.env.AGENTS_OLLAMA_BASE_URL;
  const oldFetch = globalThis.fetch;

  try {
    process.env.AGENTS_OLLAMA_MODEL = "qwen2.5-coder:14b";
    process.env.AGENTS_OLLAMA_MODELS = "llama3.1:8b, qwen2.5-coder:14b\nmistral:7b";
    process.env.AGENTS_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "deepseek-r1:8b" }, { id: "llama3.1:8b" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const modelList = await getProvider("ollama").listModels();
    assert.equal(modelList.provider, "ollama");
    assert.equal(modelList.resolution, "runtime_api");
    assert.deepEqual(modelList.models, ["deepseek-r1:8b", "llama3.1:8b"]);
    assert.equal(modelList.runtimeApiFailure, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_OLLAMA_MODEL = oldModel;
    process.env.AGENTS_OLLAMA_MODELS = oldModels;
    process.env.AGENTS_OLLAMA_BASE_URL = oldBaseUrl;
  }
});

test("provider listModels falls back to configured values for lmstudio when API fails", async () => {
  const oldModel = process.env.AGENTS_LMSTUDIO_MODEL;
  const oldModels = process.env.AGENTS_LMSTUDIO_MODELS;
  const oldBaseUrl = process.env.AGENTS_LMSTUDIO_BASE_URL;
  const oldTimeout = process.env.AGENTS_REQUEST_TIMEOUT_MS;
  const oldFetch = globalThis.fetch;

  try {
    process.env.AGENTS_LMSTUDIO_MODEL = "local-model-a";
    process.env.AGENTS_LMSTUDIO_MODELS = "local-model-a, local-model-b";
    process.env.AGENTS_LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
    process.env.AGENTS_REQUEST_TIMEOUT_MS = "1000";
    globalThis.fetch = async () => new Response("{}", { status: 500 });

    const modelList = await getProvider("lmstudio").listModels();
    assert.equal(modelList.provider, "lmstudio");
    assert.equal(modelList.resolution, "configured");
    assert.deepEqual(modelList.models, ["local-model-a", "local-model-b"]);
    assert.equal(modelList.runtimeApiFailure?.code, "http_error");
    assert.equal(modelList.runtimeApiFailure?.status, 500);
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_LMSTUDIO_MODEL = oldModel;
    process.env.AGENTS_LMSTUDIO_MODELS = oldModels;
    process.env.AGENTS_LMSTUDIO_BASE_URL = oldBaseUrl;
    process.env.AGENTS_REQUEST_TIMEOUT_MS = oldTimeout;
  }
});

test("provider listModels returns runtime_api values for lmstudio when API succeeds", async () => {
  const oldBaseUrl = process.env.AGENTS_LMSTUDIO_BASE_URL;
  const oldFetch = globalThis.fetch;

  try {
    process.env.AGENTS_LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "qwen2.5-14b-instruct" }, { id: "phi-4-mini" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const modelList = await getProvider("lmstudio").listModels();
    assert.equal(modelList.provider, "lmstudio");
    assert.equal(modelList.resolution, "runtime_api");
    assert.deepEqual(modelList.models, ["qwen2.5-14b-instruct", "phi-4-mini"]);
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_LMSTUDIO_BASE_URL = oldBaseUrl;
  }
});

test("listProviders returns all supported providers", () => {
  const providers = listProviders().sort();
  assert.deepEqual(providers, [
    "anthropic",
    "gemini",
    "lmstudio",
    "ollama",
    "openai",
    "openrouter"
  ]);
});

test("provider listModels accepts override baseUrl/apiKey options", async () => {
  const oldFetch = globalThis.fetch;
  try {
    let calledUrl = "";
    let authHeader = "";
    globalThis.fetch = async (url, init) => {
      calledUrl = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      authHeader = headers.Authorization ?? "";
      return new Response(
        JSON.stringify({
          data: [{ id: "override-model-a" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const modelList = await getProvider("ollama").listModels({
      baseUrl: "http://127.0.0.1:5999/v1",
      apiKey: "override-ollama-key"
    });

    assert.equal(calledUrl, "http://127.0.0.1:5999/v1/models");
    assert.equal(authHeader, "Bearer override-ollama-key");
    assert.equal(modelList.resolution, "runtime_api");
    assert.deepEqual(modelList.models, ["override-model-a"]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("provider listModels resolves with precedence direct > .env > process.env", async () => {
  const oldFetch = globalThis.fetch;
  const oldBaseUrl = process.env.AGENTS_OLLAMA_BASE_URL;
  const oldApiKey = process.env.AGENTS_OLLAMA_API_KEY;
  try {
    process.env.AGENTS_OLLAMA_BASE_URL = "http://env-ollama/v1";
    process.env.AGENTS_OLLAMA_API_KEY = "env-ollama-key";

    await withDotEnv(
      [
        "AGENTS_OLLAMA_BASE_URL=http://dotenv-ollama/v1",
        "AGENTS_OLLAMA_API_KEY=dotenv-ollama-key"
      ].join("\n"),
      async () => {
        const callUrls: string[] = [];
        const authHeaders: string[] = [];
        globalThis.fetch = async (url, init) => {
          callUrls.push(String(url));
          const headers = (init?.headers ?? {}) as Record<string, string>;
          authHeaders.push(headers.Authorization ?? "");
          return new Response(
            JSON.stringify({
              data: [{ id: "priority-model" }]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        };

        await getProvider("ollama").listModels();
        await getProvider("ollama").listModels({
          baseUrl: "http://direct-ollama/v1",
          apiKey: "direct-ollama-key"
        });

        assert.equal(callUrls[0], "http://dotenv-ollama/v1/models");
        assert.equal(authHeaders[0], "Bearer dotenv-ollama-key");
        assert.equal(callUrls[1], "http://direct-ollama/v1/models");
        assert.equal(authHeaders[1], "Bearer direct-ollama-key");
      }
    );
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_OLLAMA_BASE_URL = oldBaseUrl;
    process.env.AGENTS_OLLAMA_API_KEY = oldApiKey;
  }
});

test("provider listModels tries runtime API for all supported providers", async () => {
  const oldFetch = globalThis.fetch;
  try {
    const calledUrls: string[] = [];
    const authHeaders: string[] = [];
    globalThis.fetch = async (url, init) => {
      calledUrls.push(String(url));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      authHeaders.push(headers.Authorization ?? "");
      return new Response(
        JSON.stringify({
          data: [{ id: "runtime-model" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const providers = listProviders();
    for (const provider of providers) {
      const modelList = await getProvider(provider).listModels({
        baseUrl: `http://127.0.0.1:7${provider.length}31`,
        apiKey: `${provider}-api-key`
      });
      assert.equal(modelList.provider, provider);
      assert.equal(modelList.resolution, "runtime_api");
      assert.deepEqual(modelList.models, ["runtime-model"]);
    }

    const expectedSuffixByProvider: Record<string, string> = {
      openai: "/v1",
      ollama: "/v1",
      lmstudio: "/v1",
      gemini: "/v1beta/openai",
      anthropic: "/v1",
      openrouter: "/api/v1"
    };
    const expectedUrls = listProviders().map((provider) => {
      return `http://127.0.0.1:7${provider.length}31${expectedSuffixByProvider[provider]}/models`;
    });
    assert.deepEqual(calledUrls, expectedUrls);
    assert.deepEqual(
      authHeaders,
      listProviders().map((provider) => `Bearer ${provider}-api-key`)
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("provider listModels accepts override BASE_URL/API_KEY aliases", async () => {
  const oldFetch = globalThis.fetch;
  try {
    let calledUrl = "";
    let authHeader = "";
    globalThis.fetch = async (url, init) => {
      calledUrl = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      authHeader = headers.Authorization ?? "";
      return new Response(
        JSON.stringify({
          data: [{ id: "alias-model-a" }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const modelList = await getProvider("openai").listModels({
      BASE_URL: "http://127.0.0.1:6888/v1",
      API_KEY: "alias-openai-key"
    });

    assert.equal(calledUrl, "http://127.0.0.1:6888/v1/models");
    assert.equal(authHeader, "Bearer alias-openai-key");
    assert.equal(modelList.resolution, "runtime_api");
    assert.deepEqual(modelList.models, ["alias-model-a"]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("provider listModels timeout precedence uses direct > AGENTS_MODEL_LIST_TIMEOUT_MS > AGENTS_REQUEST_TIMEOUT_MS > default", async () => {
  const oldModelListTimeout = process.env.AGENTS_MODEL_LIST_TIMEOUT_MS;
  const oldRequestTimeout = process.env.AGENTS_REQUEST_TIMEOUT_MS;
  const oldBaseUrl = process.env.AGENTS_OLLAMA_BASE_URL;
  const oldFetch = globalThis.fetch;

  try {
    process.env.AGENTS_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
    globalThis.fetch = async (_url, init) => {
      await new Promise<void>((resolve) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (!signal) {
          resolve();
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true }
        );
      });
      return new Response("{}", { status: 503 });
    };

    delete process.env.AGENTS_MODEL_LIST_TIMEOUT_MS;
    delete process.env.AGENTS_REQUEST_TIMEOUT_MS;
    const startDefault = Date.now();
    await getProvider("ollama").listModels();
    const elapsedDefault = Date.now() - startDefault;
    assert.ok(elapsedDefault >= 1500 && elapsedDefault < 4000);

    process.env.AGENTS_MODEL_LIST_TIMEOUT_MS = "250";
    process.env.AGENTS_REQUEST_TIMEOUT_MS = "5000";
    const startModelList = Date.now();
    await getProvider("ollama").listModels();
    const elapsedModelList = Date.now() - startModelList;
    assert.ok(elapsedModelList >= 150 && elapsedModelList < 1500);

    const startDirect = Date.now();
    await getProvider("ollama").listModels({ timeoutMs: 700 });
    const elapsedDirect = Date.now() - startDirect;
    assert.ok(elapsedDirect >= 550 && elapsedDirect < 2200);
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_MODEL_LIST_TIMEOUT_MS = oldModelListTimeout;
    process.env.AGENTS_REQUEST_TIMEOUT_MS = oldRequestTimeout;
    process.env.AGENTS_OLLAMA_BASE_URL = oldBaseUrl;
  }
});

test("provider listModels returns timeout failure reason when request aborts", async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (!signal) {
          reject(new Error("signal missing"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            const abortError = new Error("aborted");
            (abortError as Error & { name: string }).name = "AbortError";
            reject(abortError);
          },
          { once: true }
        );
      });
    };

    const modelList = await getProvider("anthropic").listModels({
      BASE_URL: "http://127.0.0.1:7555",
      API_KEY: "test-key",
      timeoutMs: 300
    });
    assert.equal(modelList.resolution, "environment_dependent");
    assert.equal(modelList.runtimeApiFailure?.code, "timeout");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("provider listModels falls back to default when API is unreachable and provider has default model", async () => {
  const oldModel = process.env.AGENTS_OPENAI_MODEL;
  const oldFetch = globalThis.fetch;
  try {
    delete process.env.AGENTS_OPENAI_MODEL;
    globalThis.fetch = async () => new Response("{}", { status: 503 });

    const modelList = await getProvider("openai").listModels({
      BASE_URL: "http://127.0.0.1:7111/v1",
      API_KEY: "test-openai-key",
      timeoutMs: 300
    });
    assert.equal(modelList.provider, "openai");
    assert.equal(modelList.resolution, "default");
    assert.deepEqual(modelList.models, ["gpt-4.1-mini"]);
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_OPENAI_MODEL = oldModel;
  }
});

test("provider listModels falls back to environment_dependent when API is unreachable and no configured/default model exists", async () => {
  const oldModel = process.env.AGENTS_ANTHROPIC_MODEL;
  const oldFetch = globalThis.fetch;
  try {
    delete process.env.AGENTS_ANTHROPIC_MODEL;
    globalThis.fetch = async () => new Response("{}", { status: 503 });

    const modelList = await getProvider("anthropic").listModels({
      BASE_URL: "http://127.0.0.1:7222/v1",
      API_KEY: "test-anthropic-key",
      timeoutMs: 300
    });
    assert.equal(modelList.provider, "anthropic");
    assert.equal(modelList.resolution, "environment_dependent");
    assert.deepEqual(modelList.models, []);
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_ANTHROPIC_MODEL = oldModel;
  }
});

test("getModel appends provider suffix when anthropic baseUrl does not include /v1", () => {
  const oldBaseUrl = process.env.AGENTS_ANTHROPIC_BASE_URL;
  const oldApiKey = process.env.AGENTS_ANTHROPIC_API_KEY;
  const oldModel = process.env.AGENTS_ANTHROPIC_MODEL;
  try {
    process.env.AGENTS_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    process.env.AGENTS_ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.AGENTS_ANTHROPIC_MODEL = "claude-sonnet-4-5";

    const model = getProvider("anthropic").getModel();
    assert.equal(model.baseUrl, "https://api.anthropic.com/v1");
  } finally {
    process.env.AGENTS_ANTHROPIC_BASE_URL = oldBaseUrl;
    process.env.AGENTS_ANTHROPIC_API_KEY = oldApiKey;
    process.env.AGENTS_ANTHROPIC_MODEL = oldModel;
  }
});

test("provider listModels appends gemini /v1beta/openai suffix when missing", async () => {
  const oldFetch = globalThis.fetch;
  try {
    let calledUrl = "";
    globalThis.fetch = async (url) => {
      calledUrl = String(url);
      return new Response("{}", { status: 503 });
    };

    await getProvider("gemini").listModels({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gemini-key",
      timeoutMs: 300
    });

    assert.equal(
      calledUrl,
      "https://generativelanguage.googleapis.com/v1beta/openai/models"
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("provider listModels appends openrouter /api/v1 suffix when missing", async () => {
  const oldFetch = globalThis.fetch;
  try {
    let calledUrl = "";
    globalThis.fetch = async (url) => {
      calledUrl = String(url);
      return new Response("{}", { status: 503 });
    };

    await getProvider("openrouter").listModels({
      baseUrl: "https://openrouter.ai",
      apiKey: "openrouter-key",
      timeoutMs: 300
    });

    assert.equal(calledUrl, "https://openrouter.ai/api/v1/models");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("provider listModels does not duplicate suffix when baseUrl already includes provider suffix", async () => {
  const oldFetch = globalThis.fetch;
  try {
    let calledUrl = "";
    globalThis.fetch = async (url) => {
      calledUrl = String(url);
      return new Response("{}", { status: 503 });
    };

    await getProvider("openrouter").listModels({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "openrouter-key",
      timeoutMs: 300
    });

    assert.equal(calledUrl, "https://openrouter.ai/api/v1/models");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("model.generate parses chat completion tool_calls", async () => {
  const oldModel = process.env.AGENTS_OLLAMA_MODEL;
  const oldBaseUrl = process.env.AGENTS_OLLAMA_BASE_URL;
  const oldFetch = globalThis.fetch;

  process.env.AGENTS_OLLAMA_MODEL = "gpt-oss-20b";
  process.env.AGENTS_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, false);
    assert.equal(body.model, "gpt-oss-20b");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "done",
              tool_calls: [
                {
                  function: {
                    name: "echo",
                    arguments: "{\"text\":\"hello\"}"
                  }
                }
              ]
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const model = getProvider("ollama").getModel();
    const tools: Tool[] = [
      {
        name: "echo",
        description: "echo",
        kind: "function",
        execute: async (args) => args
      }
    ];

    const result = await model.generate({
      agent: {
        name: "provider-test",
        instructions: "test",
        tools
      },
      inputText: "hello",
      toolCalls: []
    });

    assert.equal(result.outputText, "done");
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls?.[0].toolName, "echo");
    assert.deepEqual(result.toolCalls?.[0].args, { text: "hello" });
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_OLLAMA_MODEL = oldModel;
    process.env.AGENTS_OLLAMA_BASE_URL = oldBaseUrl;
  }
});

test("model.generate parses streaming chat completion chunks", async () => {
  const oldModel = process.env.AGENTS_OLLAMA_MODEL;
  const oldBaseUrl = process.env.AGENTS_OLLAMA_BASE_URL;
  const oldFetch = globalThis.fetch;

  process.env.AGENTS_OLLAMA_MODEL = "gpt-oss-20b";
  process.env.AGENTS_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);

    const chunks = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"echo\",\"arguments\":\"{\\\"text\\\":\\\"ok\\\"}\"}}]}}]}\n\n",
      "data: [DONE]\n\n"
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });

    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  };

  try {
    const model = getProvider("ollama").getModel();
    const result = await model.generate({
      agent: {
        name: "provider-stream-test",
        instructions: "test",
        tools: []
      },
      inputText: "hello",
      toolCalls: [],
      stream: true
    });

    assert.equal(result.outputText, "Hello world");
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls?.[0].toolName, "echo");
    assert.deepEqual(result.toolCalls?.[0].args, { text: "ok" });
  } finally {
    globalThis.fetch = oldFetch;
    process.env.AGENTS_OLLAMA_MODEL = oldModel;
    process.env.AGENTS_OLLAMA_BASE_URL = oldBaseUrl;
  }
});
