import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = new URL("../../.claude-plugin/marketplace.json", import.meta.url);
const { plugins } = JSON.parse(readFileSync(file, "utf8"));

const CATEGORIES = [
  "See what's happening",
  "Guard your repo",
  "Spend less",
  "My setup (fork and adapt)",
  "For fun",
];
const TAGS = ["band", "pane", "statusline", "guard", "toast", "command"];

for (const p of plugins) {
  test(`${p.name}: category is one of the README groups`, () => {
    assert.ok(CATEGORIES.includes(p.category), `bad category: ${p.category}`);
  });
  test(`${p.name}: tags are known`, () => {
    assert.ok(Array.isArray(p.tags), "tags must be an array");
    for (const t of p.tags) assert.ok(TAGS.includes(t), `unknown tag: ${t}`);
  });
  test(`${p.name}: needs is an array of non-empty strings`, () => {
    if (p.needs === undefined) return;
    assert.ok(Array.isArray(p.needs), "needs must be an array");
    for (const n of p.needs) {
      assert.ok(typeof n === "string" && n.trim() !== "", "empty need");
    }
  });
}
