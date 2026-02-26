import { AgentGuardrails, GuardrailHandler } from "./types";

export interface StaticGuardrailRule {
  denyWhen(inputText: string): boolean;
  reason: string;
}

export interface GuardrailsTemplateOptions {
  inputRules?: StaticGuardrailRule[];
  outputRules?: StaticGuardrailRule[];
  toolRules?: GuardrailHandler[];
}

export function createGuardrailsTemplate(options?: GuardrailsTemplateOptions): AgentGuardrails {
  const input = createStaticHandlers(options?.inputRules);
  const output = createStaticHandlers(options?.outputRules);
  const tool = options?.toolRules ?? [];

  return {
    input: input.length > 0 ? input : undefined,
    // Tool execution decision should primarily come from SafetyAgent.
    tool: tool.length > 0 ? tool : undefined,
    output: output.length > 0 ? output : undefined
  };
}

function createStaticHandlers(rules: StaticGuardrailRule[] | undefined): GuardrailHandler[] {
  if (!rules || rules.length === 0) {
    return [];
  }

  return rules.map((rule) => {
    return ({ stage, inputText, finalOutputText }) => {
      const target = stage === "output" ? finalOutputText ?? "" : inputText;
      const denied = rule.denyWhen(target);
      return {
        allow: !denied,
        reason: denied ? rule.reason : undefined
      };
    };
  });
}
