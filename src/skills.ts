import { promises as fs } from "node:fs";
import path from "node:path";
import { ensure } from "./errors";
import {
  JsonObject,
  Skill,
  SkillDescriptor,
  SkillManifest,
  SkillMode,
  SkillSummary,
  Tool
} from "./types";
import { tool } from "./tools";

export interface LoadSkillsOptions {
  dir: string;
  mode?: SkillMode;
}

export class SkillRegistry {
  public async loadSkills(options: LoadSkillsOptions): Promise<Skill[]> {
    ensure(options?.dir, "AGENTS-E-SKILL-NOT-LOADED", "loadSkills requires dir.");
    const mode = options.mode ?? "function_tool";

    const stats = await fs.stat(options.dir).catch(() => null);
    ensure(stats?.isDirectory(), "AGENTS-E-SKILL-NOT-LOADED", `Directory not found: ${options.dir}`);

    const files = await findSkillFiles(options.dir);
    const skills: Skill[] = [];

    for (const filePath of files) {
      const source = await fs.readFile(filePath, "utf8");
      skills.push(parseSkillFile(source, filePath, mode));
    }

    return skills;
  }

  public toTools(skills: Skill[]): Tool[] {
    validateSkills(skills);
    return skills.map((skill) => {
      const name = `skill.${skill.descriptor.skill_id}`;
      return {
        name,
        description: skill.manifest.overview,
        kind: "skill",
        parameters: skill.descriptor.input_schema,
        metadata: {
          skill_id: skill.descriptor.skill_id,
          mode: skill.descriptor.mode,
          source_path: skill.source_path,
          skill_overview: skill.manifest.overview,
          skill_constraints: skill.manifest.constraints,
          skill_tags: skill.manifest.tags
        },
        execute: async (args) => ({
          skill_id: skill.descriptor.skill_id,
          mode: skill.descriptor.mode,
          args
        })
      };
    });
  }
}

export class SkillMetadataExtractor {
  public async listSkills(skills: Skill[]): Promise<SkillSummary[]> {
    validateSkills(skills);
    return skills.map((skill) => ({
      skill_id: skill.descriptor.skill_id,
      name: skill.manifest.name,
      overview: skill.manifest.overview,
      tags: skill.manifest.tags
    }));
  }

  public async describeSkill(
    skills: Skill[],
    skillId: string,
    detailLevel: "summary" | "full" = "summary"
  ): Promise<SkillManifest> {
    validateSkills(skills);
    const skill = skills.find((item) => item.descriptor.skill_id === skillId);
    ensure(skill, "AGENTS-E-SKILL-NOT-FOUND", `Skill not found: ${skillId}`);

    if (detailLevel === "full") {
      return skill.manifest;
    }

    return {
      ...skill.manifest,
      usage_examples: skill.manifest.usage_examples.slice(0, 1)
    };
  }

  public toIntrospectionTools(skills: Skill[]): Tool[] {
    validateSkills(skills);
    return [
      tool({
        name: "skill.list",
        description: "List loaded skills with summary.",
        execute: async () => this.listSkills(skills)
      }),
      tool({
        name: "skill.describe",
        description: "Describe a skill in summary or full detail.",
        parameters: {
          type: "object",
          properties: {
            skill_id: { type: "string" },
            detail_level: { type: "string", enum: ["summary", "full"] }
          },
          required: ["skill_id"]
        },
        execute: async (args) => {
          const skillId = typeof args.skill_id === "string" ? args.skill_id : "";
          const detail =
            args.detail_level === "full" || args.detail_level === "summary"
              ? args.detail_level
              : "summary";
          return this.describeSkill(skills, skillId, detail);
        }
      })
    ];
  }
}

const defaultRegistry = new SkillRegistry();
const defaultExtractor = new SkillMetadataExtractor();

export async function loadSkills(options: LoadSkillsOptions): Promise<Skill[]> {
  return defaultRegistry.loadSkills(options);
}

export function toTools(skills: Skill[]): Tool[] {
  return defaultRegistry.toTools(skills);
}

export async function listSkills(skills: Skill[]): Promise<SkillSummary[]> {
  return defaultExtractor.listSkills(skills);
}

export async function describeSkill(
  skills: Skill[],
  skillId: string,
  detailLevel: "summary" | "full" = "summary"
): Promise<SkillManifest> {
  return defaultExtractor.describeSkill(skills, skillId, detailLevel);
}

export function toIntrospectionTools(skills: Skill[]): Tool[] {
  return defaultExtractor.toIntrospectionTools(skills);
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSkillFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.toUpperCase() === "SKILL.MD") {
      files.push(fullPath);
    }
  }
  return files;
}

function parseSkillFile(source: string, sourcePath: string, mode: SkillMode): Skill {
  const heading = matchGroup(source, /^#\s+(.+)$/m) ?? path.basename(path.dirname(sourcePath));
  const skillId = slugify(heading);
  const tags = parseTags(source);
  const overview = parseOverview(source) ?? `Skill loaded from ${sourcePath}`;
  const constraints = parseConstraints(source);
  const inputSchema = parseInputSchema(source);
  const examples = parseExamples(source);

  const descriptor: SkillDescriptor = {
    skill_id: skillId,
    mode,
    input_schema: inputSchema
  };

  const manifest: SkillManifest = {
    skill_id: skillId,
    name: heading,
    overview,
    usage_examples: examples,
    constraints,
    tags,
    input_schema: inputSchema
  };

  return {
    descriptor,
    manifest,
    source_path: sourcePath
  };
}

function parseOverview(source: string): string | undefined {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("- ") || line.startsWith("```")) {
      continue;
    }
    return line;
  }
  return undefined;
}

function parseTags(source: string): string[] {
  const raw = matchGroup(source, /tags?\s*:\s*(.+)$/im);
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseConstraints(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const constraints: string[] = [];
  let inConstraintSection = false;

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (/^#+\s*(constraints?|rules?)\b/i.test(line)) {
      inConstraintSection = true;
      continue;
    }
    if (inConstraintSection && line.startsWith("#")) {
      inConstraintSection = false;
    }
    if (inConstraintSection && line.startsWith("- ")) {
      constraints.push(line.slice(2).trim());
    }
  }

  return constraints;
}

function parseExamples(source: string) {
  const lines = source.split(/\r?\n/);
  const examples: Array<{ title: string; input: JsonObject }> = [];

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line.startsWith("- `")) {
      continue;
    }
    const title = line.replace(/^- `/, "").replace(/`.*$/, "").trim() || "example";
    examples.push({
      title,
      input: {}
    });
  }
  return examples;
}

function parseInputSchema(source: string): JsonObject {
  const fence = matchGroup(source, /```json\s*([\s\S]*?)```/im);
  if (!fence) {
    return { type: "object", additionalProperties: true };
  }

  try {
    const parsed = JSON.parse(fence) as unknown;
    if (isObject(parsed)) {
      if (isObject(parsed.input_schema)) {
        return parsed.input_schema;
      }
      return parsed;
    }
  } catch {
    return { type: "object", additionalProperties: true };
  }

  return { type: "object", additionalProperties: true };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function matchGroup(source: string, regex: RegExp): string | undefined {
  const matched = source.match(regex);
  if (!matched || typeof matched[1] !== "string") {
    return undefined;
  }
  return matched[1].trim();
}

function isObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return true;
}

function validateSkills(skills: Skill[]): void {
  ensure(Array.isArray(skills), "AGENTS-E-SKILL-NOT-LOADED", "skills must be an array.");
}
