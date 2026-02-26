import assert from "node:assert/strict";
import test from "node:test";
import { McpGateway } from "../src/index";

test("McpGateway register/introspect/call works", async () => {
  const gateway = new McpGateway();
  let called = "";

  const handle = await gateway.register({
    server_id: "docs",
    url: "http://localhost:9000",
    listTools: async () => [
      {
        name: "search_docs",
        description: "search docs",
        risk_level: 2
      }
    ],
    callTool: async (toolName, args) => {
      called = toolName;
      return { ok: true, args };
    }
  });

  assert.equal(handle.server_id, "docs");
  assert.equal(handle.capabilities.length, 1);

  const introspected = await gateway.introspect("docs");
  assert.equal(introspected[0].name, "search_docs");

  const result = await gateway.call("docs", "search_docs", { query: "safety" });
  assert.equal(called, "search_docs");
  assert.deepEqual(result, { ok: true, args: { query: "safety" } });
});
