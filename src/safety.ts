import { AgentsError, ensure } from "./errors";
import {
  AgentCapabilitySnapshot,
  AgentLike,
  GateDecision,
  McpCapabilitySummary,
  PolicyProfile,
  PolicyProfileName,
  PolicyStore,
  SafetyAgentDecision,
  SafetyAgentDecisionInput,
  SafetyEvaluator,
  Tool,
  ToolCapabilitySummary,
  ToolCallRequest
} from "./types";

export class SafetyAgent {
  private readonly evaluator: SafetyEvaluator;

  public constructor(evaluator?: SafetyEvaluator) {
    this.evaluator =
      evaluator ??
      (() => ({
        decision: "allow",
        reason: "default-allow",
        risk_level: 1
      }));
  }

  public static allowAll(): SafetyAgent {
    return new SafetyAgent();
  }

  public async evaluate(
    agent: AgentLike,
    request: ToolCallRequest,
    policy: PolicyProfile
  ): Promise<SafetyAgentDecision> {
    try {
      const raw = await this.evaluator(agent, request, policy);
      return normalizeDecision(raw, policy.name);
    } catch (error) {
      throw new AgentsError(
        "AGENTS-E-GATE-EVAL",
        "SafetyAgent evaluation failed.",
        error
      );
    }
  }
}

export class InMemoryPolicyStore implements PolicyStore {
  private readonly profiles = new Map<PolicyProfileName, PolicyProfile>();

  public constructor() {
    this.setProfile({
      name: "strict",
      approval_mode: "always",
      allowed_tool_scopes: ["function", "skill", "mcp"]
    });
    this.setProfile({
      name: "balanced",
      approval_mode: "risk_based",
      allowed_tool_scopes: ["function", "skill", "mcp"]
    });
    this.setProfile({
      name: "fast",
      approval_mode: "never",
      allowed_tool_scopes: ["function", "skill", "mcp"]
    });
  }

  public getProfile(name: PolicyProfileName): PolicyProfile {
    const profile = this.profiles.get(name);
    ensure(profile, "AGENTS-E-POLICY-INVALID", `Unknown policy profile: ${name}`);
    return profile;
  }

  public setProfile(profile: PolicyProfile): void {
    this.profiles.set(profile.name, profile);
  }
}

export interface GateContext {
  policyProfile: PolicyProfileName;
}

export class SafetyGate {
  private readonly safetyAgent: SafetyAgent;
  private readonly policyStore: PolicyStore;

  public constructor(safetyAgent: SafetyAgent, policyStore?: PolicyStore) {
    this.safetyAgent = safetyAgent;
    this.policyStore = policyStore ?? new InMemoryPolicyStore();
  }

  public async evaluate(
    agent: AgentLike,
    request: ToolCallRequest,
    context: GateContext
  ): Promise<GateDecision> {
    const profile = this.policyStore.getProfile(context.policyProfile);
    const capabilitySnapshot = deriveAgentCapabilitySnapshot(agent);
    const targetTool = capabilitySnapshot.tool_catalog.find(
      (tool) => tool.name === request.tool_name
    );
    const enrichedRequest: ToolCallRequest = {
      ...request,
      capability_snapshot: capabilitySnapshot,
      tool_catalog: capabilitySnapshot.tool_catalog,
      target_tool: targetTool
    };

    const rawDecision = await this.safetyAgent.evaluate(agent, enrichedRequest, profile);
    validateSafetyDecision(rawDecision);

    return {
      decision: rawDecision.decision,
      reason: rawDecision.reason,
      risk_level: rawDecision.risk_level
    };
  }
}

export function deriveAgentCapabilitySnapshot(agent: AgentLike): AgentCapabilitySnapshot {
  ensure(agent, "AGENTS-E-AGENT-CAPABILITY-RESOLVE", "Agent is required.");
  ensure(
    Array.isArray(agent.tools),
    "AGENTS-E-AGENT-CAPABILITY-RESOLVE",
    "Agent.tools must be an array."
  );

  const toolNames = agent.tools.map((tool) => tool.name);
  const skillIds = new Set<string>();
  const mcpCapabilities: McpCapabilitySummary[] = [];
  const toolCatalog: ToolCapabilitySummary[] = [];

  for (const tool of agent.tools) {
    if (!tool.name) {
      throw new AgentsError(
        "AGENTS-E-AGENT-CAPABILITY-RESOLVE",
        "Agent has a tool without a name."
      );
    }

    if (tool.kind === "skill") {
      const skillId = readString(tool, "skill_id") ?? readString(tool, "skillId");
      if (skillId) {
        skillIds.add(skillId);
      }
    }

    if (tool.kind === "mcp") {
      const capabilities = readCapabilities(tool);
      if (capabilities.length === 0) {
        mcpCapabilities.push({
          name: tool.name,
          description: tool.description,
          risk_level: 3
        });
      } else {
        mcpCapabilities.push(...capabilities);
      }
    }

    toolCatalog.push(buildToolCapability(tool));
  }

  return {
    agent_name: agent.name,
    tool_names: toolNames,
    skill_ids: [...skillIds],
    mcp_capabilities: mcpCapabilities,
    tool_catalog: toolCatalog
  };
}

function validateSafetyDecision(decision: SafetyAgentDecision): void {
  const allowed = new Set(["allow", "deny", "needs_human"]);
  ensure(decision, "AGENTS-E-GATE-EVAL", "SafetyAgent decision is missing.");
  ensure(
    allowed.has(decision.decision),
    "AGENTS-E-GATE-EVAL",
    "SafetyAgent decision.decision is invalid.",
    decision
  );
  ensure(
    Number.isInteger(decision.risk_level) && decision.risk_level >= 1 && decision.risk_level <= 5,
    "AGENTS-E-GATE-EVAL",
    "SafetyAgent decision.risk_level must be an integer between 1 and 5.",
    decision
  );
  ensure(
    typeof decision.reason === "string" && decision.reason.length > 0,
    "AGENTS-E-GATE-EVAL",
    "SafetyAgent decision.reason is required.",
    decision
  );
  ensure(
    typeof decision.policy_ref === "string" && decision.policy_ref.length > 0,
    "AGENTS-E-GATE-EVAL",
    "SafetyAgent decision.policy_ref is required.",
    decision
  );
}

function readString(tool: Tool, key: string): string | undefined {
  const value = tool.metadata?.[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function readCapabilities(tool: Tool): McpCapabilitySummary[] {
  const value = tool.metadata?.capabilities;
  if (!Array.isArray(value)) {
    return [];
  }

  const list: McpCapabilitySummary[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.name === "string" &&
      typeof record.description === "string" &&
      typeof record.risk_level === "number"
    ) {
      list.push({
        name: record.name,
        description: record.description,
        risk_level: Math.max(1, Math.min(5, Math.floor(record.risk_level)))
      });
    }
  }
  return list;
}

function buildToolCapability(tool: Tool): ToolCapabilitySummary {
  const capability: ToolCapabilitySummary = {
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    parameters_schema: tool.parameters
  };

  if (tool.kind === "skill") {
    const skillId = readString(tool, "skill_id") ?? readString(tool, "skillId");
    const overview = readString(tool, "skill_overview");
    const constraints = readStringArray(tool, "skill_constraints");
    const tags = readStringArray(tool, "skill_tags");
    capability.skill = {
      skill_id: skillId,
      overview,
      constraints: constraints.length > 0 ? constraints : undefined,
      tags: tags.length > 0 ? tags : undefined
    };
  }

  if (tool.kind === "mcp") {
    capability.mcp_capabilities = readCapabilities(tool);
  }

  return capability;
}

function readStringArray(tool: Tool, key: string): string[] {
  const value = tool.metadata?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeDecision(
  decision: SafetyAgentDecisionInput,
  policyRefFallback: string
): SafetyAgentDecision {
  return {
    decision: decision.decision,
    reason: decision.reason,
    risk_level: decision.risk_level,
    policy_ref: decision.policy_ref ?? policyRefFallback
  };
}
