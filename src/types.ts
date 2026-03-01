export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type ProviderName =
  | "openai"
  | "ollama"
  | "lmstudio"
  | "gemini"
  | "anthropic"
  | "openrouter";

export type ToolKind = "function" | "mcp" | "skill" | "introspection";
export type PolicyProfileName = "strict" | "balanced" | "fast";
export type GateDecisionKind = "allow" | "deny" | "needs_human";

export interface ToolContext {
  runId: string;
  agent: AgentLike;
  inputText: string;
}

export interface Tool {
  name: string;
  description: string;
  kind: ToolKind;
  parameters?: JsonObject;
  metadata?: Record<string, unknown>;
  execute(args: JsonObject, context: ToolContext): Promise<unknown> | unknown;
}

export type GuardrailStage = "input" | "tool" | "output";

export interface GuardrailCheckInput {
  stage: GuardrailStage;
  agent: AgentLike;
  inputText: string;
  requestedToolCall?: RequestedToolCall;
  toolCallResult?: ToolCallResult;
  finalOutputText?: string;
}

export interface GuardrailResult {
  allow: boolean;
  reason?: string;
  metadata?: JsonObject;
}

export type GuardrailHandler = (
  input: GuardrailCheckInput
) => Promise<GuardrailResult> | GuardrailResult;

export interface AgentGuardrails {
  input?: GuardrailHandler[];
  tool?: GuardrailHandler[];
  output?: GuardrailHandler[];
}

export interface AgentLike {
  name: string;
  instructions: string;
  tools: Tool[];
  model?: Model;
  guardrails?: AgentGuardrails;
}

export interface InputItem {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ToolCallResult {
  tool_name: string;
  tool_kind: ToolKind;
  args: JsonObject;
  output: unknown;
}

export interface ModelGenerateRequest {
  agent: AgentLike;
  inputText: string;
  toolCalls: ToolCallResult[];
  stream?: boolean;
}

export interface ModelGenerateResult {
  outputText?: string;
  toolCalls?: RequestedToolCall[];
  raw?: unknown;
}

export interface Model {
  provider: ProviderName;
  name: string;
  baseUrl: string;
  timeoutMs: number;
  headers?: Record<string, string>;
  generate(request: ModelGenerateRequest): Promise<ModelGenerateResult>;
}

export interface McpCapabilitySummary {
  name: string;
  description: string;
  risk_level: number;
}

export interface SkillCapabilitySummary {
  skill_id?: string;
  overview?: string;
  constraints?: string[];
  tags?: string[];
}

export interface ToolCapabilitySummary {
  name: string;
  kind: ToolKind;
  description: string;
  parameters_schema?: JsonObject;
  skill?: SkillCapabilitySummary;
  mcp_capabilities?: McpCapabilitySummary[];
}

export interface AgentCapabilitySnapshot {
  agent_name: string;
  tool_names: string[];
  skill_ids: string[];
  mcp_capabilities: McpCapabilitySummary[];
  tool_catalog: ToolCapabilitySummary[];
}

export interface ToolCallRequest {
  tool_name: string;
  tool_kind: "mcp" | "function" | "skill";
  args: JsonObject;
  user_intent: string;
  capability_snapshot?: AgentCapabilitySnapshot;
  tool_catalog?: ToolCapabilitySummary[];
  target_tool?: ToolCapabilitySummary;
}

export interface GateDecision {
  decision: GateDecisionKind;
  risk_level: number;
  reason: string;
  approval_id?: string;
}

export interface HumanApprovalRequest {
  approval_id: string;
  run_id: string;
  required_action: string;
  prompt: string;
  status: "pending" | "approved" | "denied";
}

export interface ResumeToken {
  token: string;
  run_id: string;
  expires_at: string;
  status: "active" | "used" | "expired";
}

export interface ResumeOptions {
  token: string;
  human_response?: string;
}

export interface RequestedToolCall {
  toolName: string;
  args?: JsonObject;
  userIntent?: string;
}

export interface AgentExtensionsOptions {
  policyProfile?: PolicyProfileName;
  requireHumanApproval?: boolean;
  resume?: ResumeOptions;
  toolCalls?: RequestedToolCall[];
  maxTurns?: number;
}

export interface RunOptions {
  stream?: boolean;
  extensions?: AgentExtensionsOptions;
}

export interface UsageStats {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface RunResult {
  run_id: string;
  output_text: string;
  messages: InputItem[];
  tool_calls: ToolCallResult[];
  usage: UsageStats;
  interruptions?: HumanApprovalRequest[];
  extensions?: JsonObject;
}

export interface PolicyProfile {
  name: PolicyProfileName;
  approval_mode: "always" | "risk_based" | "never";
  allowed_tool_scopes: Array<"function" | "skill" | "mcp">;
}

export interface PolicyStore {
  getProfile(name: PolicyProfileName): PolicyProfile;
  setProfile(profile: PolicyProfile): void;
}

export interface SafetyAgentDecision {
  decision: GateDecisionKind;
  reason: string;
  risk_level: number;
  policy_ref: string;
}

export type SafetyAgentDecisionInput = Omit<SafetyAgentDecision, "policy_ref"> &
  Partial<Pick<SafetyAgentDecision, "policy_ref">>;

export type SafetyEvaluator = (
  agent: AgentLike,
  request: ToolCallRequest,
  policy: PolicyProfile
) => Promise<SafetyAgentDecisionInput> | SafetyAgentDecisionInput;

export type ProviderModelListResolution =
  | "configured"
  | "default"
  | "environment_dependent"
  | "runtime_api";

export interface ProviderModelList {
  provider: ProviderName;
  models: string[];
  resolution: ProviderModelListResolution;
  runtimeApiFailure?: ProviderModelListFailure;
}

export type ProviderModelListFailureCode =
  | "http_error"
  | "timeout"
  | "network_error"
  | "invalid_payload"
  | "empty_response";

export interface ProviderModelListFailure {
  code: ProviderModelListFailureCode;
  message: string;
  status?: number;
  statusText?: string;
}

export interface ProviderModelListOptions {
  baseUrl?: string;
  apiKey?: string;
  BASE_URL?: string;
  API_KEY?: string;
  model?: string;
  models?: string[];
  MODEL?: string;
  MODELS?: string[];
  timeoutMs?: number;
  TIMEOUT_MS?: number;
}

export interface ProviderHandle {
  name: ProviderName;
  getModel(modelName?: string): Model;
  listModels(options?: ProviderModelListOptions): Promise<ProviderModelList>;
}

export type SkillMode = "function_tool" | "child_agent";

export interface SkillDescriptor {
  skill_id: string;
  mode: SkillMode;
  input_schema: JsonObject;
  output_schema?: JsonObject;
}

export interface SkillExample {
  title: string;
  input: JsonObject;
  expected_output?: JsonObject;
}

export interface SkillManifest {
  skill_id: string;
  name: string;
  overview: string;
  usage_examples: SkillExample[];
  constraints: string[];
  tags: string[];
  input_schema: JsonObject;
}

export interface Skill {
  descriptor: SkillDescriptor;
  manifest: SkillManifest;
  source_path: string;
}

export interface SkillSummary {
  skill_id: string;
  name: string;
  overview: string;
  tags: string[];
}

export interface AgentRunnerOptions {
  safetyAgent?: {
    evaluate(
      agent: AgentLike,
      request: ToolCallRequest,
      policy: PolicyProfile
    ): Promise<SafetyAgentDecisionInput>;
  };
  policyStore?: PolicyStore;
  resumeTokenTtlSec?: number;
}
