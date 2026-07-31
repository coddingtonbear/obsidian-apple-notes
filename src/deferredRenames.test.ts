import assert from "node:assert/strict";
import { test } from "node:test";
import {
	collectDeferredRenames,
	collectStatusRenames,
	performDeferredRenames,
	type DeferredRename,
	type VaultRenamer,
} from "./deferredRenames";
import type { PullChange, SerializedPlanEntry } from "./icloudMdClient";

const change = (partial: Partial<PullChange> & Pick<PullChange, "file">): PullChange => ({
	kind: "update",
	...partial,
});

void test("collectDeferredRenames maps sync-folder paths into the vault folder", () => {
	const changes = [
		change({ file: "Groceries 2.md", pendingRename: "Groceries.md" }),
		change({ file: "Recipes/Old.md", pendingRename: "Recipes/New.md" }),
	];
	assert.deepEqual(collectDeferredRenames(changes, "Apple Notes"), [
		{ from: "Apple Notes/Groceries 2.md", to: "Apple Notes/Groceries.md" },
		{ from: "Apple Notes/Recipes/Old.md", to: "Apple Notes/Recipes/New.md" },
	]);
});

void test("collectDeferredRenames ignores changes without a pending rename, or one matching the current path", () => {
	const changes = [
		change({ file: "Untouched.md" }),
		change({ file: "Same.md", pendingRename: "Same.md" }),
		change({ file: "Moved.md", kind: "move", previousFile: "Elsewhere/Moved.md" }),
	];
	assert.deepEqual(collectDeferredRenames(changes, "Apple Notes"), []);
});

void test("collectDeferredRenames tolerates a summary without changes (an older icloud-md)", () => {
	assert.deepEqual(collectDeferredRenames(undefined, "Apple Notes"), []);
});

void test("collectDeferredRenames handles a vault-root folder and a trailing slash", () => {
	const changes = [change({ file: "Note.md", pendingRename: "Renamed.md" })];
	assert.deepEqual(collectDeferredRenames(changes, ""), [{ from: "Note.md", to: "Renamed.md" }]);
	assert.deepEqual(collectDeferredRenames(changes, "Apple Notes/"), [
		{ from: "Apple Notes/Note.md", to: "Apple Notes/Renamed.md" },
	]);
});

const entry = (partial: Partial<SerializedPlanEntry> & Pick<SerializedPlanEntry, "kind" | "file">): SerializedPlanEntry => ({
	resolution: "conflict",
	...partial,
});

void test("collectStatusRenames maps outstanding rename entries into the vault folder", () => {
	const entries = [
		entry({ kind: "rename", file: "Groceries 2.md", pendingRename: "Groceries.md" }),
		entry({ kind: "rename", file: "Recipes/Old.md", pendingRename: "Recipes/New.md" }),
	];
	assert.deepEqual(collectStatusRenames(entries, "Apple Notes"), [
		{ from: "Apple Notes/Groceries 2.md", to: "Apple Notes/Groceries.md" },
		{ from: "Apple Notes/Recipes/Old.md", to: "Apple Notes/Recipes/New.md" },
	]);
});

void test("collectStatusRenames ignores other entry kinds and renames without a distinct target", () => {
	const entries = [
		entry({ kind: "update", file: "Changed.md", resolution: "ready" }),
		entry({ kind: "move", file: "Moved.md", previousFile: "Elsewhere/Moved.md", resolution: "ready" }),
		// A move entry can carry the note's tracked path in other fields;
		// only kind "rename" means "this file should be renamed by us".
		entry({ kind: "update", file: "Odd.md", pendingRename: "Odder.md", resolution: "ready" }),
		entry({ kind: "rename", file: "NoTarget.md" }),
		entry({ kind: "rename", file: "Same.md", pendingRename: "Same.md" }),
	];
	assert.deepEqual(collectStatusRenames(entries, "Apple Notes"), []);
});

void test("collectStatusRenames tolerates missing entries and a vault-root folder", () => {
	assert.deepEqual(collectStatusRenames(undefined, "Apple Notes"), []);
	assert.deepEqual(collectStatusRenames([entry({ kind: "rename", file: "A.md", pendingRename: "B.md" })], ""), [
		{ from: "A.md", to: "B.md" },
	]);
});

/** A VaultRenamer over a set of existing paths, recording renames. */
function fakeVault(existing: string[]): VaultRenamer & { renamed: DeferredRename[] } {
	const paths = new Set(existing);
	const renamed: DeferredRename[] = [];
	return {
		renamed,
		exists: (path) => paths.has(path),
		rename: (from, to) => {
			if (!paths.delete(from)) {
				return Promise.reject(new Error("the file is no longer there"));
			}
			paths.add(to);
			renamed.push({ from, to });
			return Promise.resolve();
		},
	};
}

void test("performDeferredRenames performs each rename and reports it", async () => {
	const vault = fakeVault(["A/one.md", "A/two.md"]);
	const renames = [
		{ from: "A/one.md", to: "A/uno.md" },
		{ from: "A/two.md", to: "A/dos.md" },
	];
	const outcome = await performDeferredRenames(renames, vault);
	assert.deepEqual(outcome, { performed: renames, blocked: [], failed: [] });
	assert.deepEqual(vault.renamed, renames);
});

void test("performDeferredRenames skips a rename whose target is occupied, leaving the file alone", async () => {
	const vault = fakeVault(["A/one.md", "A/uno.md"]);
	const outcome = await performDeferredRenames([{ from: "A/one.md", to: "A/uno.md" }], vault);
	assert.deepEqual(outcome, { performed: [], blocked: [{ from: "A/one.md", to: "A/uno.md" }], failed: [] });
	assert.deepEqual(vault.renamed, []);
});

void test("performDeferredRenames reports a missing source as failed and carries on with the rest", async () => {
	const vault = fakeVault(["A/two.md"]);
	const outcome = await performDeferredRenames(
		[
			{ from: "A/gone.md", to: "A/renamed.md" },
			{ from: "A/two.md", to: "A/dos.md" },
		],
		vault,
	);
	assert.deepEqual(outcome.performed, [{ from: "A/two.md", to: "A/dos.md" }]);
	assert.deepEqual(outcome.blocked, []);
	assert.equal(outcome.failed.length, 1);
	assert.deepEqual(outcome.failed[0].rename, { from: "A/gone.md", to: "A/renamed.md" });
	assert.match(outcome.failed[0].message, /no longer there/);
});
