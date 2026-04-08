import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceSkillEntries } from "./skills.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-symlink-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveContainedSkillPath symlink fallback", () => {
  it.runIf(process.platform !== "win32")(
    "loads bundled skills when SKILL.md is a symlink pointing outside the resolved root",
    async () => {
      // Simulate dist-runtime/extensions layout:
      //   base/dist/extensions/my-skill/SKILL.md  (real file)
      //   base/dist-runtime/extensions/my-skill/SKILL.md -> symlink to dist version
      //
      // The bundled root is dist-runtime/extensions (a real directory).
      // realpathSync(SKILL.md) lands in dist/ which is outside the resolved root.
      // The logical-path fallback should accept it because the bundled root is trusted.

      const base = await createTempDir();

      const realSkillDir = path.join(base, "dist", "extensions", "my-skill");
      await fs.mkdir(realSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(realSkillDir, "SKILL.md"),
        `---
name: my-skill
description: A test skill behind a symlink
---
# My Skill
`,
      );

      const runtimeSkillDir = path.join(base, "dist-runtime", "extensions", "my-skill");
      await fs.mkdir(runtimeSkillDir, { recursive: true });
      await fs.symlink(path.join(realSkillDir, "SKILL.md"), path.join(runtimeSkillDir, "SKILL.md"));

      const workspaceDir = path.join(base, "workspace");
      await fs.mkdir(workspaceDir, { recursive: true });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: path.join(workspaceDir, ".managed"),
        bundledSkillsDir: path.join(base, "dist-runtime", "extensions"),
      });

      const names = entries.map((entry) => entry.skill.name);
      expect(names).toContain("my-skill");
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects symlinked SKILL.md in workspace skills pointing outside the root",
    async () => {
      // Workspace skills do NOT get allowSymlinks, so symlinks pointing
      // outside the resolved root should still be rejected.

      const base = await createTempDir();
      const outsideBase = await createTempDir();

      const outsideSkillDir = path.join(outsideBase, "evil-skill");
      await fs.mkdir(outsideSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(outsideSkillDir, "SKILL.md"),
        `---
name: evil-skill
description: Should not be loaded
---
# Evil
`,
      );

      const workspaceDir = path.join(base, "workspace");
      const skillsDir = path.join(workspaceDir, "skills", "evil-skill");
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.symlink(path.join(outsideSkillDir, "SKILL.md"), path.join(skillsDir, "SKILL.md"));

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const names = entries.map((entry) => entry.skill.name);
      expect(names).not.toContain("evil-skill");
    },
  );
});
