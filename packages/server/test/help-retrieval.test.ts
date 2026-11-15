// metrics-by-runtime: the help assistant answers from the help topics it finds for the question. A question about how
// a skill did in each agent must bring the topic that explains the "By agent" metrics into the model context.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus } from "../src/llm/corpus.ts";
import { topTopics } from "../src/llm/retrieval.ts";
import type { AppConfig } from "../src/config.ts";

// No built web app: the corpus comes from the help topic sources.
const config = { webDir: "/nonexistent-web-dir" } as AppConfig;

test("questions about a skill in each agent find the metrics topic in the first three", () => {
  const corpus = loadCorpus(config, "en");
  assert.ok(corpus.length > 100, `help corpus not found: ${corpus.length} topics`);
  for (const q of [
    "How did this skill do in each agent, Claude Code or OpenCode?",
    "Which agent works better with this skill?",
  ]) {
    const ids = topTopics(corpus, q, 3).map((t) => t.id);
    assert.ok(ids.includes("getting-started/reading-metrics"), `${q} -> ${ids.join(", ")}`);
  }
});
