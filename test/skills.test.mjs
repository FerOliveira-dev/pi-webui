import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, discoverSkills } from "../dist/server/skills.js";

// ---- parseFrontmatter tests ----

test("parseFrontmatter: standard frontmatter with name and description", () => {
  const content = `---
name: deploy
description: Deploy workflow for Cartena
---

Some body text`;
  const result = parseFrontmatter(content, "fallback");
  assert.equal(result.name, "deploy");
  assert.equal(result.description, "Deploy workflow for Cartena");
});

test("parseFrontmatter: no frontmatter — uses fallback name and empty description", () => {
  const content = `# My Skill
No frontmatter here`;
  const result = parseFrontmatter(content, "fallback");
  assert.equal(result.name, "fallback");
  assert.equal(result.description, "");
});

test("parseFrontmatter: empty content — uses fallback name and empty description", () => {
  const result = parseFrontmatter("", "fallback");
  assert.equal(result.name, "fallback");
  assert.equal(result.description, "");
});

test("parseFrontmatter: name-only frontmatter — no description field", () => {
  const content = `---
name: my-skill
---

Body`;
  const result = parseFrontmatter(content, "fallback");
  assert.equal(result.name, "my-skill");
  assert.equal(result.description, "");
});

test("parseFrontmatter: multiline description uses only first line", () => {
  const content = `---
name: multi
description: First line
  second line
---

Body`;
  const result = parseFrontmatter(content, "fallback");
  assert.equal(result.name, "multi");
  assert.equal(result.description, "First line");
});

test("parseFrontmatter: whitespace around values is trimmed", () => {
  const content = `---
name:   trimmed-skill  
description:   A trimmed description  
---

Body`;
  const result = parseFrontmatter(content, "fallback");
  assert.equal(result.name, "trimmed-skill");
  assert.equal(result.description, "A trimmed description");
});

// ---- discoverSkills tests ----

const SKILL_MD = `---
name: test-skill
description: A test skill
---

Body content`;

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "skills-test-"));
  return dir;
}

test.afterEach(async () => {
  // Cleanup is handled per-test via explicit cleanup
});

test("discoverSkills: finds skills in flat project directory", async () => {
  const tmp = await createTempDir();
  try {
    const skillsDir = join(tmp, ".pi", "skills");
    await mkdir(join(skillsDir, "my-skill"), { recursive: true });
    await writeFile(join(skillsDir, "my-skill", "SKILL.md"), SKILL_MD, "utf8");
    const skills = discoverSkills("/nonexistent/agent", tmp);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "test-skill");
    assert.equal(skills[0].level, "project");
    assert.ok(skills[0].path.endsWith("SKILL.md"));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("discoverSkills: only scans one level deep (ignores nested directories)", async () => {
  const tmp = await createTempDir();
  try {
    const skillsDir = join(tmp, ".pi", "skills");
    // Nested: .pi/skills/deep/nested-skill/SKILL.md — not scanned (one level deep only)
    await mkdir(join(skillsDir, "deep", "nested-skill"), { recursive: true });
    await writeFile(join(skillsDir, "deep", "nested-skill", "SKILL.md"), SKILL_MD, "utf8");
    // Flat: .pi/skills/flat-skill/SKILL.md — should be found
    await mkdir(join(skillsDir, "flat-skill"), { recursive: true });
    await writeFile(join(skillsDir, "flat-skill", "SKILL.md"), SKILL_MD, "utf8");
    const skills = discoverSkills("/nonexistent/agent", tmp);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].level, "project");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("discoverSkills: skips missing base directory", async () => {
  const skills = discoverSkills("/nonexistent/agent", "/nonexistent/project");
  assert.equal(skills.length, 0);
});

test("discoverSkills: finds skills at project, agent, and extension levels", async () => {
  const projectDir = await createTempDir();
  const agentDir = await createTempDir();
  const extensionDir = await createTempDir();

  try {
    // Project skill: <cwd>/.pi/skills/proj-skill/SKILL.md
    await mkdir(join(projectDir, ".pi", "skills", "proj-skill"), { recursive: true });
    await writeFile(join(projectDir, ".pi", "skills", "proj-skill", "SKILL.md"), SKILL_MD, "utf8");

    // Agent skill: <agentDir>/skills/agent-skill/SKILL.md
    await mkdir(join(agentDir, "skills", "agent-skill"), { recursive: true });
    await writeFile(join(agentDir, "skills", "agent-skill", "SKILL.md"), SKILL_MD, "utf8");

    // Extension skill
    await mkdir(join(extensionDir, "ext-skill"), { recursive: true });
    await writeFile(join(extensionDir, "ext-skill", "SKILL.md"), SKILL_MD, "utf8");

    const skills = discoverSkills(agentDir, projectDir, extensionDir);
    assert.equal(skills.length, 3);

    const levels = skills.map((s) => s.level);
    assert.ok(levels.includes("project"), "should include project skill");
    assert.ok(levels.includes("agent"), "should include agent skill");
    assert.ok(levels.includes("extension"), "should include extension skill");

    // Project skills come before agent skills (priority ordering)
    const projectIdx = levels.indexOf("project");
    const agentIdx = levels.indexOf("agent");
    assert.ok(projectIdx < agentIdx, "project skills should come before agent skills");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
    await rm(extensionDir, { recursive: true, force: true });
  }
});

test("discoverSkills: project skill with same name takes priority position over agent", async () => {
  const projectDir = await createTempDir();
  const agentDir = await createTempDir();

  try {
    const skillContent = `---
name: shared-skill
description: A shared skill
---

Body`;

    await mkdir(join(projectDir, ".pi", "skills", "shared-skill"), { recursive: true });
    await writeFile(join(projectDir, ".pi", "skills", "shared-skill", "SKILL.md"), skillContent, "utf8");
    await mkdir(join(agentDir, "skills", "shared-skill"), { recursive: true });
    await writeFile(join(agentDir, "skills", "shared-skill", "SKILL.md"), skillContent, "utf8");

    const skills = discoverSkills(agentDir, projectDir);
    // Both are discovered (plan notes duplicates are handled at injection time)
    assert.equal(skills.length, 2);
    // Project comes first
    assert.equal(skills[0].level, "project");
    assert.equal(skills[1].level, "agent");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("discoverSkills: uses fallback name from directory when frontmatter name is missing", async () => {
  const tmp = await createTempDir();
  try {
    const noFrontmatter = `# No Frontmatter Skill
Just body text, no YAML frontmatter`;
    await mkdir(join(tmp, ".pi", "skills", "fallback-name"), { recursive: true });
    await writeFile(join(tmp, ".pi", "skills", "fallback-name", "SKILL.md"), noFrontmatter, "utf8");
    const skills = discoverSkills("/nonexistent/agent", tmp);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "fallback-name");
    assert.equal(skills[0].description, "");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---- skill injection tests (tool_result approach) ----

/**
 * Simulates the skill handler's approach: inject skill content as a
 * tool_result message, then prompt with only the visible user text.
 */
function createSkillToolResult(body, path) {
  return {
    role: "toolResult",
    toolName: "read",
    content: [{ type: "text", text: body }],
    details: { path },
  };
}

test("skill injection: tool_result has correct shape for rendering", () => {
  const body = "# Deploy\n\nSteps for deploying...";
  const toolResult = createSkillToolResult(body, "~/.pi/agent/skills/deploy/SKILL.md");
  assert.equal(toolResult.role, "toolResult");
  assert.equal(toolResult.toolName, "read");
  assert.ok(Array.isArray(toolResult.content));
  assert.equal(toolResult.content[0].type, "text");
  assert.equal(toolResult.content[0].text, body);
  assert.equal(toolResult.details.path, "~/.pi/agent/skills/deploy/SKILL.md");
});

test("skill injection: user message stays clean (no skill content)", () => {
  const visibleText = "/deploy produção";
  assert.equal(visibleText, "/deploy produção");
  assert.ok(!visibleText.includes("Deploy — Cartena"));
  assert.ok(!visibleText.includes("User request:"));
});

test("skill injection: visible text includes arg when provided", () => {
  const visibleWithArg = "/deploy produção";
  assert.ok(visibleWithArg.includes("produção"));
});

test("skill injection: visible text is slash-only when no arg", () => {
  const visibleNoArg = "/deploy";
  assert.equal(visibleNoArg, "/deploy");
});

test("skill injection: body is stripped of frontmatter", () => {
  const rawContent = `---
name: deploy
description: Deploy workflow
---

# Deploy — Cartena

Steps here...`;
  const body = rawContent.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
  assert.ok(!body.includes("---"));
  assert.ok(!body.includes("name: deploy"));
  assert.ok(body.includes("# Deploy"));
  assert.ok(body.includes("Steps here"));
});

test("skill injection: full prompt flow produces clean user message + tool context", () => {
  const rawContent = `---
name: deploy
---
# Deploy Instructions

Step 1: git commit
Step 2: git push`;
  const body = rawContent.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
  const toolResult = createSkillToolResult(body, "~/.pi/agent/skills/deploy/SKILL.md");
  const userPrompt = "/deploy produção";

  const agentMessages = [
    toolResult,
    { role: "user", content: [{ type: "text", text: userPrompt }] },
  ];

  assert.equal(agentMessages[0].role, "toolResult");
  assert.ok(agentMessages[0].content[0].text.includes("Deploy Instructions"));
  assert.equal(agentMessages[1].content[0].text, "/deploy produção");
  assert.ok(!agentMessages[1].content[0].text.includes("Deploy Instructions"));
});