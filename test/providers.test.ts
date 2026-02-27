import assert from "node:assert/strict";
import test from "node:test";
import { AgentsError, getProvider } from "../src/index";
import { Tool } from "../src/types";

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

