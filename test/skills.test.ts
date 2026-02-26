import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  describeSkill,
  listSkills,
  loadSkills,
  toIntrospectionTools,
  toTools
} from "../src/index";

test("loadSkills returns Skill[] and toTools converts them", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skills-"));
  const skillDir = path.join(tempRoot, "writer");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "# Writer Skill",
      "",
      "Create concise summaries for user input.",
      "",
      "tags: writing,summary",
      "",
      "## Constraints",
      "- Keep output short",
      "- No private data",
      "",
      "```json",
      "{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}},\"required\":[\"text\"]}",
      "```"
    ].join("\n"),
    "utf8"
  );

  const skills = await loadSkills({ dir: tempRoot, mode: "function_tool" });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].descriptor.skill_id, "writer-skill");

  const toolList = toTools(skills);
  assert.equal(toolList.length, 1);
  assert.equal(toolList[0].kind, "skill");
  assert.equal(toolList[0].name, "skill.writer-skill");

  const summaries = await listSkills(skills);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].skill_id, "writer-skill");

  const manifest = await describeSkill(skills, "writer-skill", "full");
  assert.equal(manifest.tags.includes("writing"), true);

  const introspectionTools = toIntrospectionTools(skills);
  assert.deepEqual(
    introspectionTools.map((item) => item.name),
    ["skill.list", "skill.describe"]
  );
});
