import { ensure } from "./errors";
import { AgentGuardrails, AgentLike, Model, Tool } from "./types";

export interface AgentOptions {
  name: string;
  instructions: string;
  tools?: Tool[];
  model?: Model;
  guardrails?: AgentGuardrails;
}

export class Agent implements AgentLike {
  public readonly name: string;
  public readonly instructions: string;
  public readonly tools: Tool[];
  public readonly model?: Model;
  public readonly guardrails?: AgentGuardrails;

  public constructor(options: AgentOptions) {
    ensure(options.name?.trim(), "AGENTS-E-RUNNER-CONFIG", "Agent.name is required.");
    ensure(
      options.instructions?.trim(),
      "AGENTS-E-RUNNER-CONFIG",
      "Agent.instructions is required."
    );

    this.name = options.name;
    this.instructions = options.instructions;
    this.tools = options.tools ? [...options.tools] : [];
    this.model = options.model;
    this.guardrails = options.guardrails;
  }
}
