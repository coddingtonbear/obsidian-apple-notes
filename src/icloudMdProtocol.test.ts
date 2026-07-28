import assert from "node:assert/strict";
import { test } from "node:test";
import { parseErrorPayload, parseProgressLine, parseResultPayload } from "./icloudMdProtocol";

void test("parseProgressLine parses each greppable progress event", () => {
	assert.deepEqual(parseProgressLine("icloud-md:progress:fetch:42"), { type: "fetch", recordsSoFar: 42 });
	assert.deepEqual(parseProgressLine("icloud-md:progress:process-start:100"), {
		type: "process-start",
		total: 100,
	});
	assert.deepEqual(parseProgressLine("icloud-md:progress:process:3/100"), {
		type: "process",
		processed: 3,
		total: 100,
	});
	assert.deepEqual(parseProgressLine("icloud-md:progress:process-done"), { type: "process-done" });
});

void test("parseProgressLine ignores plain status lines", () => {
	assert.equal(parseProgressLine("Opening a browser window for iCloud sign-in..."), undefined);
});

void test("parseErrorPayload extracts the trailing JSON error blob amid interleaved progress/status lines", () => {
	const stderr = [
		"icloud-md:progress:fetch:10",
		"Signing in...",
		"icloud-md:progress:process-start:10",
		"{",
		'  "error": "AuthenticationExpiredError",',
		'  "message": "Your iCloud session has expired.",',
		'  "exitCode": 1',
		"}",
		"",
	].join("\n");

	assert.deepEqual(parseErrorPayload(stderr), {
		error: "AuthenticationExpiredError",
		message: "Your iCloud session has expired.",
		exitCode: 1,
	});
});

void test("parseErrorPayload returns undefined for stderr with no structured payload", () => {
	assert.equal(parseErrorPayload("spawn icloud-md ENOENT\n"), undefined);
});

interface TestSummary {
	written: number;
}

void test("parseResultPayload reads a clean JSON result", () => {
	assert.deepEqual(parseResultPayload<TestSummary>('{\n  "written": 311\n}\n'), { value: { written: 311 } });
});

void test("parseResultPayload finds the result after tool output that polluted stdout", () => {
	// icloud-md shells out to Playwright's installer on first sign-in, and its
	// download progress lands on stdout ahead of the JSON payload.
	const stdout = [
		"Downloading Chromium 141.0.7390.37 (playwright build v1194) from https://cdn.playwright.dev/chromium-win64.zip",
		"|████████████████| 100% of 141.2 MiB",
		"Chromium 141.0.7390.37 downloaded to C:\\Users\\me\\AppData\\Local\\ms-playwright\\chromium-1194",
		"{",
		'  "written": 311',
		"}",
		"",
	].join("\n");

	assert.deepEqual(parseResultPayload<TestSummary>(stdout), { value: { written: 311 } });
});

void test("parseResultPayload ignores braces appearing in the noise before the payload", () => {
	const stdout = ['Resolving {chromium} build...\n{\n  "written": 1\n}\n'].join("");
	assert.deepEqual(parseResultPayload<TestSummary>(stdout), { value: { written: 1 } });
});

void test("parseResultPayload returns undefined when stdout holds no JSON at all", () => {
	assert.equal(parseResultPayload("Downloading Chromium...\n"), undefined);
	assert.equal(parseResultPayload(""), undefined);
});
