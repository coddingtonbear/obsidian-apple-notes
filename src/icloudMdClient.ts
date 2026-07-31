import { runIcloudMd } from "./cliRunner";
import {
	parseErrorPayload,
	parseProgressLine,
	parseResultPayload,
	type IcloudMdErrorPayload,
	type IcloudMdProgress,
} from "./icloudMdProtocol";
import type IcloudPlugin from "./main";

export type { IcloudMdErrorPayload, IcloudMdProgress };

export interface IcloudMdCallOptions {
	onProgress?: (event: IcloudMdProgress) => void;
	/** Human status lines (e.g. "Opening a browser window for iCloud sign-in..."). */
	onStatusLine?: (message: string) => void;
}

export type IcloudMdCallResult<T> = { ok: true; data: T } | { ok: false; error: IcloudMdErrorPayload };

/** `status`/`push --dry-run` use exit code 3 to mean "succeeded, action needed" - stdout still has valid JSON. Anything else non-zero is a real failure. */
const SUCCESS_CODES = new Set([0, 3]);

/** A short, single-line excerpt of unexpected output, for an error message a user can act on. */
function summarizeOutput(output: string): string {
	const trimmed = output.trim().replace(/\s+/g, " ");
	if (trimmed.length === 0) {
		return "(no output)";
	}
	return trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
}

function splitOutputLine(line: string, options: IcloudMdCallOptions): void {
	const progress = parseProgressLine(line);
	if (progress) {
		options.onProgress?.(progress);
	} else if (line.length > 0) {
		options.onStatusLine?.(line);
	}
}

/** Runs `icloud-md --json <args>`, streaming stderr progress/status lines as they arrive and parsing stdout/stderr into a typed result once the process exits. */
export async function runIcloudMdJson<T>(
	plugin: IcloudPlugin,
	args: string[],
	options: IcloudMdCallOptions = {},
): Promise<IcloudMdCallResult<T>> {
	let stderrTail = "";
	const result = await runIcloudMd(plugin, ["--json", ...args], {
		onOutput: (chunk, stream) => {
			if (stream !== "stderr") {
				return;
			}
			stderrTail += chunk;
			const lines = stderrTail.split("\n");
			stderrTail = lines.pop() ?? "";
			for (const line of lines) {
				splitOutputLine(line.trimEnd(), options);
			}
		},
	});
	if (stderrTail.length > 0) {
		splitOutputLine(stderrTail.trimEnd(), options);
	}

	if (result.error) {
		return { ok: false, error: { error: "SpawnError", message: result.error.message, exitCode: -1 } };
	}
	if (result.code !== null && SUCCESS_CODES.has(result.code)) {
		const payload = parseResultPayload<T>(result.stdout);
		if (payload) {
			return { ok: true, data: payload.value };
		}
		// The command succeeded but stdout held no JSON we could find. Report
		// it rather than letting JSON.parse throw into an unhandled rejection,
		// which surfaced only in the developer console.
		return {
			ok: false,
			error: {
				error: "UnreadableOutput",
				message: `icloud-md succeeded but its output could not be read as JSON: ${summarizeOutput(result.stdout)}`,
				exitCode: result.code,
			},
		};
	}
	return {
		ok: false,
		error: parseErrorPayload(result.stderr) ?? {
			error: "UnknownError",
			message: result.stderr.trim() || `icloud-md exited with code ${result.code}`,
			exitCode: result.code ?? -1,
		},
	};
}

export interface CloneSummary {
	written: number;
	writtenShared: number;
	writtenUnpublishable: number;
	attachmentsDownloaded: number;
	skippedDeleted: number;
	skippedUndecodable: number;
}

export interface PullNotice {
	level: "info" | "warn";
	message: string;
}

export type PullChangeKind = "add" | "update" | "merge" | "remove" | "move" | "untrack";

export interface PullChangeRemark {
	tone: "conflict" | "unsyncable" | "note";
	message: string;
}

/** One file-level thing a pull did, mirroring icloud-md's `PullChange`. Paths
 * are relative to the sync folder, POSIX-separated. */
export interface PullChange {
	kind: PullChangeKind;
	file: string;
	previousFile?: string;
	/** Set by `--defer-renames`: the path this file should be renamed to, which
	 * pull deliberately did *not* rename it to - we perform it through
	 * Obsidian instead, so wikilinks get rewritten. See `deferredRenames.ts`. */
	pendingRename?: string;
	remarks?: PullChangeRemark[];
}

export interface PullSummary {
	added: number;
	updated: number;
	merged: number;
	removed: number;
	attachmentsDownloaded: number;
	unpublishable: number;
	skippedNewUnsyncable: number;
	droppedUnsyncable: number;
	unsharedUntracked: number;
	changes: PullChange[];
	conflicts: string[];
	notices: PullNotice[];
}

export type PlanEntryKind = "create" | "createFolder" | "update" | "delete" | "move" | "rename";
export type PlanResolution = "ready" | "refused" | "conflict" | "noop";

/** One entry of the push plan `status` and `push --dry-run` report, mirroring
 * icloud-md's `SerializedPlanEntry`. Paths are relative to the sync folder,
 * POSIX-separated. */
export interface SerializedPlanEntry {
	kind: PlanEntryKind;
	file: string;
	resolution: PlanResolution;
	reason?: string;
	/** kind "createFolder" only: `file` is a directory, and this is the Notes
	 * folder title it will be given. */
	folderTitle?: string;
	/** kind "move" only: the path the note was tracked at before the local move. */
	previousFile?: string;
	/** kind "rename" only: where `file` is supposed to end up - a rename some
	 * earlier `pull --defer-renames` left outstanding. Unlike pull (which is
	 * incremental and only re-reports a rename when the note changes remotely
	 * again), status rebuilds this from tracked state every run - which is what
	 * lets `refreshStatus`'s sweep finish renames deferred outside the plugin.
	 * See `deferredRenames.ts`. */
	pendingRename?: string;
	/** A note about an entry that is otherwise going through fine. */
	remark?: string;
}

export interface PushEntryResult extends SerializedPlanEntry {
	outcome?: { succeeded: boolean; message: string };
}

export interface PushResult {
	dryRun: boolean;
	pushed?: number;
	entries: PushEntryResult[];
}

export interface StatusResult {
	entries: SerializedPlanEntry[];
	/** Tracked notes the plan left untouched. */
	unchanged: number;
	/** Plan-level warnings that aren't about one entry. */
	notices: PullNotice[];
}

export interface ReauthenticateResult {
	appleId: string;
	dsid: string;
	targetDir: string;
}

export interface VersionInfo {
	version: string;
}

export interface CloneOptions {
	/** icloud-md only accepts `--filename-as-title` at clone time, which is why
	 * the corresponding setting locks once connected. */
	filenameAsTitle: boolean;
}

export function cloneIcloudMd(
	plugin: IcloudPlugin,
	targetDir: string,
	cloneOptions: CloneOptions,
	options?: IcloudMdCallOptions,
) {
	const args = cloneOptions.filenameAsTitle ? ["clone", "--filename-as-title", targetDir] : ["clone", targetDir];
	return runIcloudMdJson<CloneSummary>(plugin, args, options);
}

export function pullIcloudMd(plugin: IcloudPlugin, targetDir: string, options?: IcloudMdCallOptions) {
	// Renames a remote retitle wants are deferred so we can perform them
	// through Obsidian's file manager, which rewrites wikilinks - see
	// `deferredRenames.ts`. Requires icloud-md >= 0.5.0.
	return runIcloudMdJson<PullSummary>(plugin, ["pull", "--defer-renames", targetDir], options);
}

export function pushIcloudMd(plugin: IcloudPlugin, targetDir: string, options?: IcloudMdCallOptions) {
	return runIcloudMdJson<PushResult>(plugin, ["push", targetDir], options);
}

export function statusIcloudMd(plugin: IcloudPlugin, targetDir: string, options?: IcloudMdCallOptions) {
	return runIcloudMdJson<StatusResult>(plugin, ["status", targetDir], options);
}

export function reauthenticateIcloudMd(plugin: IcloudPlugin, targetDir: string, options?: IcloudMdCallOptions) {
	return runIcloudMdJson<ReauthenticateResult>(plugin, ["reauthenticate", targetDir], options);
}

/** `icloud-md --json --version`, JSON-shaped since 0.4.0. Older releases don't
 * know the flag at all and exit with a usage error - `assessVersion` reads
 * that failure as "old release" rather than as a broken install. */
export function versionIcloudMd(plugin: IcloudPlugin, options?: IcloudMdCallOptions) {
	return runIcloudMdJson<VersionInfo>(plugin, ["--version"], options);
}
