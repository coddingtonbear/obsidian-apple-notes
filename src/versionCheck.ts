import type { IcloudMdCallResult, VersionInfo } from "./icloudMdClient";

type VersionTriple = [major: number, minor: number, patch: number];

/** Lowest icloud-md release this plugin is written against: 0.5.0 introduced
 * pull's `--defer-renames`, which every pull here passes. */
const MINIMUM_TRIPLE: VersionTriple = [0, 5, 0];
export const MINIMUM_ICLOUD_MD_VERSION = MINIMUM_TRIPLE.join(".");

/** What the settings tab should say about the installed icloud-md, if anything.
 * Only `outdated` and `unknown` warrant a warning - and a warning is all they
 * get: nothing is blocked on version. */
export type VersionAssessment =
	/** Reported a version that satisfies the minimum. */
	| { kind: "ok"; version: string }
	/** Reported a version below the minimum. */
	| { kind: "outdated"; version: string }
	/** The binary ran but no version could be read - `--version` only exists
	 * since 0.4.0, so this is almost certainly an old release. */
	| { kind: "unknown" }
	/** The binary couldn't be spawned at all. Not a version problem; the rest
	 * of the UI already surfaces a missing binary when a sync is attempted. */
	| { kind: "unavailable" };

/** "0.5.0" (tolerating a leading "v" and a prerelease/build suffix) to its
 * numeric parts, or null for something that isn't a version. */
export function parseVersion(version: string): VersionTriple | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (match === null) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isBelow(version: VersionTriple, minimum: VersionTriple): boolean {
	for (let i = 0; i < 3; i++) {
		if (version[i] !== minimum[i]) {
			return version[i] < minimum[i];
		}
	}
	return false;
}

/** Turns the result of `icloud-md --json --version` into a display decision. */
export function assessVersion(result: IcloudMdCallResult<VersionInfo>): VersionAssessment {
	if (result.ok === false) {
		if (result.error.error === "SpawnError") {
			return { kind: "unavailable" };
		}
		return { kind: "unknown" };
	}
	// Typed as string, but it arrived as JSON from an external process.
	const version: unknown = result.data.version;
	if (typeof version !== "string") {
		return { kind: "unknown" };
	}
	const parsed = parseVersion(version);
	if (parsed === null) {
		return { kind: "unknown" };
	}
	return isBelow(parsed, MINIMUM_TRIPLE) ? { kind: "outdated", version } : { kind: "ok", version };
}
