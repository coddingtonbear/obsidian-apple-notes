import assert from "node:assert/strict";
import { test } from "node:test";
import { describeBlock, describeIdle, summarizePlan, unannouncedBlocks, type BlockedEntry } from "./blockedEntries";
import type { SerializedPlanEntry } from "./icloudMdClient";

const entry = (partial: Partial<SerializedPlanEntry> & Pick<SerializedPlanEntry, "file">): SerializedPlanEntry => ({
	kind: "update",
	resolution: "ready",
	...partial,
});

const REFUSAL = 'markdown construct "blockquote" inside a list item has no Apple Notes equivalent.';

void test("summarizePlan counts ready entries and sets refused/conflict ones aside with vault paths", () => {
	const entries = [
		entry({ file: "Groceries.md" }),
		entry({ file: "Recipes/Soup.md", kind: "create" }),
		entry({ file: "Japan (Winter 2026).md", resolution: "refused", reason: REFUSAL }),
		entry({ file: "Shared.md", resolution: "conflict", reason: "changed in Apple Notes too" }),
		entry({ file: "Untouched.md", resolution: "noop" }),
	];
	assert.deepEqual(summarizePlan(entries, "Notes"), {
		pendingCount: 2,
		blocked: [
			{
				file: "Notes/Japan (Winter 2026).md",
				syncFile: "Japan (Winter 2026).md",
				resolution: "refused",
				reason: REFUSAL,
			},
			{ file: "Notes/Shared.md", syncFile: "Shared.md", resolution: "conflict", reason: "changed in Apple Notes too" },
		],
	});
});

void test("summarizePlan keeps a blocked entry that came without a reason", () => {
	const [blocked] = summarizePlan([entry({ file: "Odd.md", resolution: "refused" })], "Notes").blocked;
	assert.equal(blocked?.file, "Notes/Odd.md");
	assert.match(blocked?.reason ?? "", /refused/);
});

void test("summarizePlan of nothing is up to date", () => {
	assert.deepEqual(summarizePlan([], "Notes"), { pendingCount: 0, blocked: [] });
});

const blocked = (file: string, reason = REFUSAL): BlockedEntry => ({
	file,
	syncFile: file.replace(/^Notes\//, ""),
	resolution: "refused",
	reason,
});

void test("unannouncedBlocks reports every block the first time", () => {
	const { fresh, announced } = unannouncedBlocks(new Map(), [blocked("Notes/A.md"), blocked("Notes/B.md")]);
	assert.deepEqual(fresh, [blocked("Notes/A.md"), blocked("Notes/B.md")]);
	assert.deepEqual([...announced], [
		["Notes/A.md", REFUSAL],
		["Notes/B.md", REFUSAL],
	]);
});

void test("unannouncedBlocks stays quiet while the same block persists", () => {
	const first = unannouncedBlocks(new Map(), [blocked("Notes/A.md")]);
	const second = unannouncedBlocks(first.announced, [blocked("Notes/A.md")]);
	assert.deepEqual(second.fresh, []);
});

void test("unannouncedBlocks speaks up again when the reason changes or a new file joins", () => {
	const first = unannouncedBlocks(new Map(), [blocked("Notes/A.md")]);
	const second = unannouncedBlocks(first.announced, [blocked("Notes/A.md", "a different problem"), blocked("Notes/B.md")]);
	assert.deepEqual(second.fresh, [blocked("Notes/A.md", "a different problem"), blocked("Notes/B.md")]);
});

void test("unannouncedBlocks forgets a file once it clears, so a repeat block is news again", () => {
	const first = unannouncedBlocks(new Map(), [blocked("Notes/A.md")]);
	const cleared = unannouncedBlocks(first.announced, []);
	assert.deepEqual([...cleared.announced], []);
	const again = unannouncedBlocks(cleared.announced, [blocked("Notes/A.md")]);
	assert.deepEqual(again.fresh, [blocked("Notes/A.md")]);
});

void test("describeBlock names the file and passes icloud-md's reason through", () => {
	assert.equal(describeBlock(blocked("Notes/Japan.md")), `"Notes/Japan.md" can't be pushed: ${REFUSAL}`);
	assert.equal(
		describeBlock({ file: "Notes/Shared.md", syncFile: "Shared.md", resolution: "conflict", reason: "edited both sides" }),
		'"Notes/Shared.md" conflicts with Apple Notes: edited both sides',
	);
});

void test("describeIdle leads with blocked files, then the queue", () => {
	assert.equal(describeIdle({ pendingCount: 0, blocked: [] }), "up to date");
	assert.equal(describeIdle({ pendingCount: 3, blocked: [] }), "3 change(s) pending");
	assert.equal(
		describeIdle({ pendingCount: 2, blocked: [blocked("Notes/A.md"), blocked("Notes/B.md")] }),
		'2 note(s) can\'t sync: "Notes/A.md", "Notes/B.md"; 2 change(s) pending',
	);
	assert.equal(describeIdle({ pendingCount: 0, blocked: [blocked("Notes/A.md")] }), '1 note(s) can\'t sync: "Notes/A.md"');
});
