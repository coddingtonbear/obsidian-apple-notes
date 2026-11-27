import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findExistingClone,
	findExistingClones,
	parseCloneState,
	stateFilePath,
	type VaultProbe,
} from "./existingClone";

const vaultWith = (files: Record<string, string>): VaultProbe => ({
	readText: (path) => Promise.resolve(files[path]),
});

void test("stateFilePath points inside the folder, tolerating a trailing slash", () => {
	assert.equal(stateFilePath("Apple Notes"), "Apple Notes/.icloud-md/state.json");
	assert.equal(stateFilePath("Notes/Apple/"), "Notes/Apple/.icloud-md/state.json");
});

void test("parseCloneState reads titleMode, defaulting to in-body like icloud-md", () => {
	assert.deepEqual(parseCloneState('{"layoutVersion":3,"titleMode":"filename","notes":{}}'), {
		filenameAsTitle: true,
	});
	assert.deepEqual(parseCloneState('{"layoutVersion":3,"titleMode":"in-body","notes":{}}'), {
		filenameAsTitle: false,
	});
	// A layout-2 state file predates titleMode; icloud-md reads it as in-body.
	assert.deepEqual(parseCloneState('{"layoutVersion":2,"notes":{}}'), { filenameAsTitle: false });
});

void test("parseCloneState rejects anything that isn't a JSON object", () => {
	assert.equal(parseCloneState(""), undefined);
	assert.equal(parseCloneState("not json"), undefined);
	assert.equal(parseCloneState("[]"), undefined);
	assert.equal(parseCloneState("null"), undefined);
	assert.equal(parseCloneState('"filename"'), undefined);
});

void test("findExistingClone finds the clone in the named folder", async () => {
	const probe = vaultWith({ "Apple Notes/.icloud-md/state.json": '{"titleMode":"filename"}' });
	assert.deepEqual(await findExistingClone("Apple Notes", probe), { folder: "Apple Notes", filenameAsTitle: true });
	assert.deepEqual(await findExistingClone("  Apple Notes  ", probe), {
		folder: "Apple Notes",
		filenameAsTitle: true,
	});
});

void test("findExistingClone reports nothing for an empty folder name, a plain folder, or a corrupt marker", async () => {
	const probe = vaultWith({
		"Plain/notes.md": "# hi",
		"Corrupt/.icloud-md/state.json": "{{{",
	});
	assert.equal(await findExistingClone("", probe), undefined);
	assert.equal(await findExistingClone("   ", probe), undefined);
	assert.equal(await findExistingClone("Plain", probe), undefined);
	assert.equal(await findExistingClone("Corrupt", probe), undefined);
});

void test("findExistingClones keeps only the folders holding a clone, in order", async () => {
	const probe = vaultWith({
		"B/.icloud-md/state.json": '{"titleMode":"in-body"}',
		"D/.icloud-md/state.json": '{"titleMode":"filename"}',
	});
	assert.deepEqual(await findExistingClones(["A", "B", "C", "D"], probe), [
		{ folder: "B", filenameAsTitle: false },
		{ folder: "D", filenameAsTitle: true },
	]);
	assert.deepEqual(await findExistingClones([], probe), []);
});
