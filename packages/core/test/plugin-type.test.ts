import { test } from "node:test";
import assert from "node:assert/strict";
import { ARTIFACT_TYPES, isArtifactType, detectArtifactType, mainFilePath } from "../src/index.ts";

test("ARTIFACT_TYPES order and plugin labels", () => {
  assert.deepEqual(
    ARTIFACT_TYPES.map((t) => t.id),
    ["skill", "command", "agent", "hook", "plugin", "settings", "mcp-server", "rule"],
  );
  const plugin = ARTIFACT_TYPES.find((t) => t.id === "plugin")!;
  assert.equal(plugin.label, "Plugin");
  assert.equal(plugin.plural, "Plugins");
  assert.equal(plugin.mainFile("x"), ".claude-plugin/plugin.json");
  assert.equal(isArtifactType("plugin"), true);
  assert.equal(isArtifactType("nope"), false);
  assert.equal(mainFilePath("plugin", "team-kit"), ".claude-plugin/plugin.json");
  const settings = ARTIFACT_TYPES.find((t) => t.id === "settings")!;
  assert.equal(settings.label, "Settings profile");
  assert.equal(settings.plural, "Settings profiles");
  assert.equal(settings.mainFile("team-baseline"), "settings/team-baseline/settings.json");
  assert.equal(isArtifactType("settings"), true);
  assert.equal(mainFilePath("settings", "team-baseline"), "settings/team-baseline/settings.json");
});

test("detectArtifactType prefers plugin manifest", () => {
  const t = detectArtifactType([
    { path: "team-kit/.claude-plugin/plugin.json", content: "{}" },
    { path: "team-kit/skills/a/SKILL.md", content: "---\nname: a\ndescription: x\n---\n\n# A\n" },
    { path: "team-kit/hooks/hooks.json", content: "{}" },
  ]);
  assert.equal(t, "plugin");
});
