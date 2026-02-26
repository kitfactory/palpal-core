export type AgentsErrorCategory =
  | "provider"
  | "safety"
  | "approval"
  | "skills"
  | "mcp"
  | "runner"
  | "policy"
  | "unknown";

export class AgentsError extends Error {
  public readonly code: string;
  public readonly category: AgentsErrorCategory;
  public readonly details?: unknown;

  public constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AgentsError";
    this.code = code;
    this.category = inferErrorCategory(code);
    this.details = details;
  }
}

export function ensure(
  condition: unknown,
  code: string,
  message: string,
  details?: unknown
): asserts condition {
  if (!condition) {
    throw new AgentsError(code, message, details);
  }
}

export function createId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${stamp}_${random}`;
}

function inferErrorCategory(code: string): AgentsErrorCategory {
  if (code.includes("PROVIDER")) {
    return "provider";
  }
  if (code.includes("GATE") || code.includes("GUARDRAIL") || code.includes("CAPABILITY")) {
    return "safety";
  }
  if (code.includes("APPROVAL") || code.includes("RESUME")) {
    return "approval";
  }
  if (code.includes("SKILL")) {
    return "skills";
  }
  if (code.includes("MCP")) {
    return "mcp";
  }
  if (code.includes("POLICY")) {
    return "policy";
  }
  if (code.includes("RUNNER") || code.includes("RUN")) {
    return "runner";
  }
  return "unknown";
}
