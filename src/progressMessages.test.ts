import assert from "node:assert/strict";
import { test } from "node:test";
import { describeProgress, isDisplayableStatusLine } from "./progressMessages";

void test("describeProgress reports counts for every progress event", () => {
	assert.equal(describeProgress({ type: "fetch", recordsSoFar: 42 }), "Fetching notes from iCloud (42 so far)...");
	assert.equal(describeProgress({ type: "process-start", total: 7 }), "Processing 7 note(s)...");
	assert.equal(describeProgress({ type: "process", processed: 3, total: 7 }), "Processing note 3 of 7...");
	assert.equal(describeProgress({ type: "process-done" }), "Finishing up...");
});

void test("isDisplayableStatusLine keeps human status lines", () => {
	assert.equal(isDisplayableStatusLine("Opening a browser window for iCloud sign-in..."), true);
	assert.equal(isDisplayableStatusLine("  Downloading Chromium 140.0 - 170 MiB  "), true);
});

void test("isDisplayableStatusLine drops blank lines and JSON payload fragments", () => {
	assert.equal(isDisplayableStatusLine(""), false);
	assert.equal(isDisplayableStatusLine("   "), false);
	assert.equal(isDisplayableStatusLine("{"), false);
	assert.equal(isDisplayableStatusLine('  "error": "AuthenticationExpiredError",'), false);
	assert.equal(isDisplayableStatusLine("}"), false);
	assert.equal(isDisplayableStatusLine('  "conflicts": ['), false);
	assert.equal(isDisplayableStatusLine("]"), false);
});
