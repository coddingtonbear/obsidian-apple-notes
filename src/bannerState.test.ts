import assert from "node:assert/strict";
import { test } from "node:test";
import { bannerFor, dismiss, pruneDismissals } from "./bannerState";
import type { BlockedEntry } from "./blockedEntries";

const blocked = (file: string, reason = "no equivalent"): BlockedEntry => ({
	file: `Notes/${file}`,
	syncFile: file,
	kind: "update",
	resolution: "refused",
	reason,
});

void test("bannerFor finds the block for an open file and nothing for a clean one", () => {
	const entries = [blocked("A.md"), blocked("B.md")];
	assert.deepEqual(bannerFor(entries, new Map(), "Notes/B.md"), blocked("B.md"));
	assert.equal(bannerFor(entries, new Map(), "Notes/C.md"), undefined);
});

void test("a dismissed block stays hidden only while its reason holds", () => {
	const dismissed = dismiss(new Map(), blocked("A.md"));
	assert.equal(bannerFor([blocked("A.md")], dismissed, "Notes/A.md"), undefined);
	assert.deepEqual(bannerFor([blocked("A.md", "another problem")], dismissed, "Notes/A.md"), blocked("A.md", "another problem"));
});

void test("pruneDismissals forgets files that cleared, so a repeat block shows its banner again", () => {
	const dismissed = dismiss(new Map(), blocked("A.md"));
	assert.deepEqual([...pruneDismissals(dismissed, [blocked("A.md")])], [["Notes/A.md", "no equivalent"]]);
	const cleared = pruneDismissals(dismissed, []);
	assert.deepEqual([...cleared], []);
	assert.deepEqual(bannerFor([blocked("A.md")], cleared, "Notes/A.md"), blocked("A.md"));
});

void test("pruneDismissals drops a dismissal whose reason changed", () => {
	const dismissed = dismiss(new Map(), blocked("A.md"));
	assert.deepEqual([...pruneDismissals(dismissed, [blocked("A.md", "another problem")])], []);
});
