// Skill discovery and frontmatter parsing for pi-webui.
//
// Scans project-local, agent, and extension directories for SKILL.md files,
// extracts name and description from YAML frontmatter, and returns a unified
// list of SkillInfo with priority ordering (project > agent > extension).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

export interface SkillInfo {
  name: string;
  description: string;
  level: "project" | "agent" | "extension";
  path: string;
}

// Parse YAML frontmatter delimited by `---` markers.
// Extracts `name` and `description` fields using simple regex (no YAML dependency).
// Falls back to { fallback } for name and "" for description when unavailable.
export function parseFrontmatter(
  content: string,
  fallback: string,
): { name: string; description: string } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return { name: fallback, description: "" };

  const block = m[1];
  const name = (block.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || fallback;
  const desc = (block.match(/^description:\s*(.+)$/m) || [])[1]?.trim() || "";
  return { name, description: desc };
}

// Scan a single skills directory (one level deep) for SKILL.md files.
function scanDir(dir: string, level: SkillInfo["level"], out: SkillInfo[]) {
  if (!existsSync(dir)) return;
  try {
    for (const entry of readdirSync(dir)) {
      const skillPath = join(dir, entry, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      if (!statSync(skillPath).isFile()) continue;

      const content = readFileSync(skillPath, "utf8");
      const { name, description } = parseFrontmatter(content, basename(entry));
      out.push({ name, description, level, path: skillPath });
    }
  } catch {
    // ignore permission errors or non-directory entries
  }
}

// Discover skills from project-local, agent, and extension directories.
//
// @param agentDir   - pi agent config directory (e.g., ~/.pi/agent)
// @param cwd        - project working directory
// @param extensionDir - optional explicit extension skills directory for testing
// @returns array of SkillInfo with priority order: project > agent > extension
export function discoverSkills(
  agentDir: string,
  cwd: string,
  extensionDir?: string,
): SkillInfo[] {
  const skills: SkillInfo[] = [];

  // Project-local: <cwd>/.pi/skills/
  scanDir(resolve(cwd, ".pi", "skills"), "project", skills);

  // Agent: <agentDir>/skills/
  scanDir(resolve(agentDir, "skills"), "agent", skills);

  // Extension: explicit dir or auto-discovered from node_modules
  if (extensionDir) {
    scanDir(extensionDir, "extension", skills);
  } else {
    autoDiscoverExtensions(skills);
  }

  return skills;
}

// Try to discover extension skills from known node_modules locations.
// This mirrors the extension layout: <node_modules>/<pkg>/skills/<skill>/SKILL.md
function autoDiscoverExtensions(out: SkillInfo[]) {
  const home = process.env.HOME;
  if (!home) return;

  // Find node_modules dirs under ~/.local/share/pi-node/*/node_modules/
  const base = resolve(home, ".local", "share", "pi-node");
  if (!existsSync(base)) return;

  try {
    const versions = readdirSync(base);
    for (const version of versions) {
      const nmDir = join(base, version, "node_modules");
      if (!existsSync(nmDir)) continue;

      try {
        const pkgs = readdirSync(nmDir);
        for (const pkg of pkgs) {
          scanDir(join(nmDir, pkg, "skills"), "extension", out);
        }
      } catch {
        // skip versions without readable node_modules
      }
    }
  } catch {
    // skip if base dir is unreadable
  }
}
