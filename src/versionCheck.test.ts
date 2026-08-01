import assert from "node:assert/strict";
import { test } from "node:test";
import type { IcloudMdCallResult, VersionInfo } from "./icloudMdClient";
import { assessVersion, MINIMUM_ICLOUD_MD_VERSION, parseVersion } from "./versionCheck";

const reported = (version: unknown): IcloudMdCallResult<VersionInfo> => ({
	ok: true,
	data: { version: version as string },
});

const failed = (error: string): IcloudMdCallResult<VersionInfo> => ({
	ok: false,
	error: { error, message: "boom", exitCode: 1 },
});

void test("parseVersion reads plain, v-prefixed, and suffixed versions", () => {
	assert.deepEqual(parseVersion("0.5.0"), [0, 5, 0]);
	assert.deepEqual(parseVersion("v1.12.3"), [1, 12, 3]);
	assert.deepEqual(parseVersion("0.5.0-beta.1"), [0, 5, 0]);
	assert.deepEqual(parseVersion(" 0.5.0\n"), [0, 5, 0]);
});

void test("parseVersion rejects non-versions", () => {
	assert.equal(parseVersion(""), null);
	assert.equal(parseVersion("0.5"), null);
	assert.equal(parseVersion("unknown option '--version'"), null);
});

void test("assessVersion accepts the minimum and anything newer", () => {
	assert.deepEqual(assessVersion(reported(MINIMUM_ICLOUD_MD_VERSION)), {
		kind: "ok",
		version: MINIMUM_ICLOUD_MD_VERSION,
	});
	assert.deepEqual(assessVersion(reported("0.6.1")), { kind: "ok", version: "0.6.1" });
	// Numeric, not lexicographic: 0.10.0 outranks 0.6.0.
	assert.deepEqual(assessVersion(reported("0.10.0")), { kind: "ok", version: "0.10.0" });
	assert.deepEqual(assessVersion(reported("1.0.0")), { kind: "ok", version: "1.0.0" });
});

void test("assessVersion flags anything below the minimum as outdated", () => {
	assert.deepEqual(assessVersion(reported("0.4.0")), { kind: "outdated", version: "0.4.0" });
	assert.deepEqual(assessVersion(reported("0.5.1")), { kind: "outdated", version: "0.5.1" });
});

void test("assessVersion reads an unreadable or missing version as unknown", () => {
	// Releases before 0.4.0 don't know --version and exit with a usage error.
	assert.deepEqual(assessVersion(failed("UnknownError")), { kind: "unknown" });
	assert.deepEqual(assessVersion(failed("UnreadableOutput")), { kind: "unknown" });
	// JSON from outside the process could hold anything.
	assert.deepEqual(assessVersion(reported(undefined)), { kind: "unknown" });
	assert.deepEqual(assessVersion(reported(5)), { kind: "unknown" });
	assert.deepEqual(assessVersion(reported("not a version")), { kind: "unknown" });
});

void test("assessVersion treats an unspawnable binary as unavailable, not as a version problem", () => {
	assert.deepEqual(assessVersion(failed("SpawnError")), { kind: "unavailable" });
});
