import { ApprovalController } from "./approval";
import { AgentsError, createId, ensure } from "./errors";
import { SafetyAgent, SafetyGate } from "./safety";
import {
  AgentLike,
  AgentRunnerOptions,
  GuardrailCheckInput,
  GateDecision,
  InputItem,
  JsonObject,
  RequestedToolCall,
  RunOptions,
  RunResult,
  Tool,
  ToolCallRequest,
  ToolCallResult
} from "./types";

interface SuspendedRunState {
  agent: AgentLike;
  inputText: string;
  policyProfile: "strict" | "balanced" | "fast";
  pendingCalls: RequestedToolCall[];
  executedCalls: ToolCallResult[];
  continuation: "manual" | "model";
  remainingModelTurns: number;
  requireHumanApproval: boolean;
}

export class AgentRunner {
  private readonly gate: SafetyGate;
  private readonly approvalController: ApprovalController;
  private readonly suspendedRuns = new Map<string, SuspendedRunState>();

  public constructor(options: AgentRunnerOptions) {
    ensure(options?.safetyAgent, "AGENTS-E-RUNNER-CONFIG", "safetyAgent is required.");
    this.gate = new SafetyGate(options.safetyAgent as SafetyAgent, options.policyStore);
    this.approvalController = new ApprovalController(options.resumeTokenTtlSec ?? 900);
  }

  public async run(
    agent: AgentLike,
    input: string | InputItem[],
    options?: RunOptions
  ): Promise<RunResult> {
    const runId = createId("run");
    const inputText = flattenInput(input);
    await runGuardrails(agent, {
      stage: "input",
      agent,
      inputText
    });

    const policyProfile = options?.extensions?.policyProfile ?? "balanced";
    const requireHumanApproval = options?.extensions?.requireHumanApproval ?? false;
    const requestedCalls = options?.extensions?.toolCalls ?? [];

    if (requestedCalls.length > 0) {
      const manual = await this.processRequestedCalls({
        runId,
        agent,
        inputText,
        policyProfile,
        requireHumanApproval,
        continuation: "manual",
        remainingModelTurns: 0,
        requestedCalls,
        executedCalls: []
      });

      if (manual.interrupted) {
        return manual.interrupted;
      }

      return this.completeRun(runId, agent, inputText, manual.executedCalls, policyProfile);
    }

    if (agent.model) {
      const maxTurns = options?.extensions?.maxTurns ?? 6;
      return this.executeModelLoop({
        runId,
        agent,
        inputText,
        policyProfile,
        requireHumanApproval,
        executedCalls: [],
        remainingTurns: maxTurns
      });
    }
    return this.completeRun(runId, agent, inputText, [], policyProfile);
  }

  public async getPendingApprovals(runId?: string) {
    return this.approvalController.getPendingApprovals(runId);
  }

  public async submitApproval(
    approvalId: string,
    decision: "approve" | "deny",
    comment?: string
  ) {
    return this.approvalController.submitApproval(approvalId, decision, comment);
  }

  public async approveAndResume(
    runId: string,
    approvalId: string,
    options?: {
      decision?: "approve" | "deny";
      comment?: string;
      resumeOptions?: RunOptions;
    }
  ): Promise<RunResult> {
    const decision = options?.decision ?? "approve";
    const token = await this.submitApproval(approvalId, decision, options?.comment);
    return this.resumeRun(runId, token.token, options?.resumeOptions);
  }

  public async resumeRun(
    runId: string,
    token: string,
    _options?: RunOptions
  ): Promise<RunResult> {
    const state = this.suspendedRuns.get(runId);
    ensure(state, "AGENTS-E-RUNNER", `No suspended run found: ${runId}`);

    const resume = this.approvalController.consumeResumeToken(runId, token);
    if (resume.decision === "deny") {
      this.suspendedRuns.delete(runId);
      throw new AgentsError("AGENTS-E-GATE-DENIED", "Human denied approval.");
    }

    const executedCalls = [...state.executedCalls];
    const [approvedCall, ...remainingCalls] = state.pendingCalls;

    if (approvedCall) {
      await runGuardrails(state.agent, {
        stage: "tool",
        agent: state.agent,
        inputText: state.inputText,
        requestedToolCall: approvedCall
      });
      const approvedTool = findTool(state.agent.tools, approvedCall.toolName);
      executedCalls.push(
        await executeTool(runId, state.agent, state.inputText, approvedTool, approvedCall)
      );
    }

    const resumed = await this.processRequestedCalls({
      runId,
      agent: state.agent,
      inputText: state.inputText,
      policyProfile: state.policyProfile,
      requireHumanApproval: state.requireHumanApproval,
      continuation: state.continuation,
      remainingModelTurns: state.remainingModelTurns,
      requestedCalls: remainingCalls,
      executedCalls
    });

    if (resumed.interrupted) {
      return resumed.interrupted;
    }

    this.suspendedRuns.delete(runId);
    if (state.continuation === "model" && state.remainingModelTurns > 0) {
      return this.executeModelLoop({
        runId,
        agent: state.agent,
        inputText: state.inputText,
        policyProfile: state.policyProfile,
        requireHumanApproval: state.requireHumanApproval,
        executedCalls: resumed.executedCalls,
        remainingTurns: state.remainingModelTurns
      });
    }

    return this.completeRun(
      runId,
      state.agent,
      state.inputText,
      resumed.executedCalls,
      state.policyProfile
    );
  }

  private async checkAndExecuteToolCall(
    runId: string,
    agent: AgentLike,
    inputText: string,
    requested: RequestedToolCall,
    policyProfile: "strict" | "balanced" | "fast",
    requireHumanApproval: boolean
  ): Promise<
    | { kind: "executed"; toolCall: ToolCallResult }
    | { kind: "interruption"; approval: Awaited<ReturnType<ApprovalController["createApprovalRequest"]>> }
  > {
    await runGuardrails(agent, {
      stage: "tool",
      agent,
      inputText,
      requestedToolCall: requested
    });

    const tool = findTool(agent.tools, requested.toolName);
    const toolKind = normalizeToolKind(tool.kind);
    const gateRequest: ToolCallRequest = {
      tool_name: tool.name,
      tool_kind: toolKind,
      args: requested.args ?? {},
      user_intent: requested.userIntent ?? inputText
    };

    let gateDecision = await this.gate.evaluate(agent, gateRequest, { policyProfile });
    if (requireHumanApproval && gateDecision.decision === "allow") {
      gateDecision = {
        decision: "needs_human",
        reason: "requireHumanApproval option is enabled.",
        risk_level: Math.max(2, gateDecision.risk_level)
      };
    }

    if (gateDecision.decision === "deny") {
      throw new AgentsError("AGENTS-E-GATE-DENIED", gateDecision.reason);
    }

    if (gateDecision.decision === "needs_human") {
      const approval = await this.approvalController.createApprovalRequest(
        runId,
        withApprovalId(gateDecision),
        gateDecision.reason
      );
      return { kind: "interruption", approval };
    }

    return {
      kind: "executed",
      toolCall: await executeTool(runId, agent, inputText, tool, requested)
    };
  }

  private async executeModelLoop(params: {
    runId: string;
    agent: AgentLike;
    inputText: string;
    policyProfile: "strict" | "balanced" | "fast";
    requireHumanApproval: boolean;
    executedCalls: ToolCallResult[];
    remainingTurns: number;
  }): Promise<RunResult> {
    let executedCalls = [...params.executedCalls];

    for (let turn = 0; turn < params.remainingTurns; turn += 1) {
      const model = params.agent.model;
      ensure(model, "AGENTS-E-RUNNER", "Agent model is required in model execution loop.");

      const modelResult = await model.generate({
        agent: params.agent,
        inputText: params.inputText,
        toolCalls: executedCalls
      });
      const planned = modelResult.toolCalls ?? [];

      if (planned.length === 0) {
        const outputText = modelResult.outputText ?? defaultOutputText(params.inputText, executedCalls);
        return this.completeRun(
          params.runId,
          params.agent,
          params.inputText,
          executedCalls,
          params.policyProfile,
          outputText
        );
      }

      const sequence = await this.processRequestedCalls({
        runId: params.runId,
        agent: params.agent,
        inputText: params.inputText,
        policyProfile: params.policyProfile,
        requireHumanApproval: params.requireHumanApproval,
        continuation: "model",
        remainingModelTurns: params.remainingTurns - (turn + 1),
        requestedCalls: planned,
        executedCalls
      });

      if (sequence.interrupted) {
        return sequence.interrupted;
      }
      executedCalls = sequence.executedCalls;
    }

    throw new AgentsError(
      "AGENTS-E-RUNNER",
      "Model tool loop exceeded maxTurns without reaching final output."
    );
  }

  private async processRequestedCalls(params: {
    runId: string;
    agent: AgentLike;
    inputText: string;
    policyProfile: "strict" | "balanced" | "fast";
    requireHumanApproval: boolean;
    continuation: "manual" | "model";
    remainingModelTurns: number;
    requestedCalls: RequestedToolCall[];
    executedCalls: ToolCallResult[];
  }): Promise<{ executedCalls: ToolCallResult[]; interrupted?: RunResult }> {
    const executedCalls = [...params.executedCalls];

    for (let index = 0; index < params.requestedCalls.length; index += 1) {
      const request = params.requestedCalls[index];
      const execution = await this.checkAndExecuteToolCall(
        params.runId,
        params.agent,
        params.inputText,
        request,
        params.policyProfile,
        params.requireHumanApproval
      );

      if (execution.kind === "interruption") {
        this.suspendedRuns.set(params.runId, {
          agent: params.agent,
          inputText: params.inputText,
          policyProfile: params.policyProfile,
          pendingCalls: params.requestedCalls.slice(index),
          executedCalls,
          continuation: params.continuation,
          remainingModelTurns: params.remainingModelTurns,
          requireHumanApproval: params.requireHumanApproval
        });

        return {
          executedCalls,
          interrupted: this.buildInterruptedResult(
            params.runId,
            params.inputText,
            params.policyProfile,
            executedCalls,
            [execution.approval]
          )
        };
      }

      executedCalls.push(execution.toolCall);
    }

    return { executedCalls };
  }

  private buildInterruptedResult(
    runId: string,
    inputText: string,
    policyProfile: "strict" | "balanced" | "fast",
    executedCalls: ToolCallResult[],
    approvals: Awaited<ReturnType<ApprovalController["createApprovalRequest"]>>[]
  ): RunResult {
    return {
      run_id: runId,
      output_text: "Execution paused. Human approval is required.",
      messages: [{ role: "assistant", content: "Execution paused for approval." }],
      tool_calls: executedCalls,
      usage: usageFromText(inputText, "Execution paused for approval."),
      interruptions: approvals,
      extensions: {
        policy_profile: policyProfile,
        interrupted: true
      }
    };
  }

  private async completeRun(
    runId: string,
    agent: AgentLike,
    inputText: string,
    toolCalls: ToolCallResult[],
    policyProfile: "strict" | "balanced" | "fast",
    outputTextOverride?: string
  ): Promise<RunResult> {
    const output = outputTextOverride ?? await generateOutput(agent, inputText, toolCalls);
    await runGuardrails(agent, {
      stage: "output",
      agent,
      inputText,
      finalOutputText: output
    });

    return {
      run_id: runId,
      output_text: output,
      messages: [{ role: "assistant", content: output }],
      tool_calls: toolCalls,
      usage: usageFromText(inputText, output),
      extensions: {
        policy_profile: policyProfile,
        interrupted: false
      }
    };
  }
}

async function runGuardrails(agent: AgentLike, input: GuardrailCheckInput): Promise<void> {
  const handlers = agent.guardrails?.[input.stage];
  if (!handlers || handlers.length === 0) {
    return;
  }

  for (const handler of handlers) {
    const result = await handler(input);
    if (!result.allow) {
      throw new AgentsError(
        "AGENTS-E-GUARDRAIL-DENIED",
        result.reason ?? `Guardrail denied at ${input.stage} stage.`
      );
    }
  }
}

export function createRunner(options: AgentRunnerOptions): AgentRunner {
  return new AgentRunner(options);
}

const defaultRunner = createRunner({ safetyAgent: SafetyAgent.allowAll() });

export async function run(
  agent: AgentLike,
  input: string | InputItem[],
  options?: RunOptions
): Promise<RunResult> {
  return defaultRunner.run(agent, input, options);
}

export async function getPendingApprovals(runId?: string) {
  return defaultRunner.getPendingApprovals(runId);
}

export async function submitApproval(
  approvalId: string,
  decision: "approve" | "deny",
  comment?: string
) {
  return defaultRunner.submitApproval(approvalId, decision, comment);
}

export async function resumeRun(
  runId: string,
  token: string,
  options?: RunOptions
): Promise<RunResult> {
  return defaultRunner.resumeRun(runId, token, options);
}

export async function approveAndResume(
  runId: string,
  approvalId: string,
  options?: {
    decision?: "approve" | "deny";
    comment?: string;
    resumeOptions?: RunOptions;
  }
): Promise<RunResult> {
  return defaultRunner.approveAndResume(runId, approvalId, options);
}

function normalizeToolKind(kind: Tool["kind"]): "mcp" | "function" | "skill" {
  if (kind === "mcp" || kind === "skill" || kind === "function") {
    return kind;
  }
  return "function";
}

function withApprovalId(gateDecision: GateDecision): GateDecision {
  if (gateDecision.approval_id) {
    return gateDecision;
  }
  return { ...gateDecision, approval_id: createId("approval") };
}

function findTool(tools: Tool[], name: string): Tool {
  const tool = tools.find((candidate) => candidate.name === name);
  ensure(tool, "AGENTS-E-SKILL-NOT-FOUND", `Tool not found: ${name}`);
  return tool;
}

async function executeTool(
  runId: string,
  agent: AgentLike,
  inputText: string,
  tool: Tool,
  requested: RequestedToolCall
): Promise<ToolCallResult> {
  const args = requested.args ?? {};
  const output = await tool.execute(args as JsonObject, {
    runId,
    agent,
    inputText
  });

  return {
    tool_name: tool.name,
    tool_kind: tool.kind,
    args,
    output
  };
}

function flattenInput(input: string | InputItem[]): string {
  if (typeof input === "string") {
    return input;
  }
  return input.map((item) => `${item.role}:${item.content}`).join("\n");
}

function usageFromText(inputText: string, outputText: string) {
  const inputTokens = Math.max(1, Math.ceil(inputText.length / 4));
  const outputTokens = Math.max(1, Math.ceil(outputText.length / 4));
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens
  };
}

async function generateOutput(
  agent: AgentLike,
  inputText: string,
  toolCalls: ToolCallResult[]
): Promise<string> {
  if (agent.model) {
    const modelResult = await agent.model.generate({
      agent,
      inputText,
      toolCalls
    });
    return modelResult.outputText ?? defaultOutputText(inputText, toolCalls);
  }

  return defaultOutputText(inputText, toolCalls);
}

function defaultOutputText(inputText: string, toolCalls: ToolCallResult[]): string {
  if (toolCalls.length === 0) {
    return inputText;
  }
  return `Executed ${toolCalls.length} tool call(s).`;
}
