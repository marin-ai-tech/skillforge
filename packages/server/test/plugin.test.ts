import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginName, buildPluginJson } from "../src/distribution/plugin.ts";

test("pluginName: skill keeps name; others append type", () => {
  assert.equal(pluginName("skill", "pdf-tools"), "pdf-tools");
  assert.equal(pluginName("command", "propose"), "propose-command");
  assert.equal(pluginName("agent", "handoff-executor"), "handoff-executor-agent");
  assert.equal(pluginName("hook", "destructive-guard"), "destructive-guard-hook");
});

test("buildPluginJson: fields", () => {
  const json = buildPluginJson(
    {
      type: "hook",
      name: "destructive-guard",
      status: "active",
      description: "Guard hook",
      tags: "[]",
    },
    {
      version: "0.1.0",
      digest: "a".repeat(64),
      description: "Guard hook",
      tags: ["safety"],
      published_by: "admin",
    },
    { baseUrl: "http://127.0.0.1:8787/" },
  );
  assert.equal(json.name, "destructive-guard-hook");
  assert.equal(json.author.name, "admin");
  assert.equal(json.metadata.skillforge_type, "hook");
  assert.equal(json.metadata.skillforge_name, "destructive-guard");
  assert.equal(json.metadata.registry, "http://127.0.0.1:8787");
  assert.deepEqual(json.keywords, ["safety"]);
});
