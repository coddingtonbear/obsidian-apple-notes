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
	conflicts: string[];
	notices: PullNotice[];
}

export type PlanEntryKind = "create" | "update" | "delete" | "move";
export type PlanResolution = "ready" | "refused" | "conflict" | "noop";

export interface SerializedPlanEntry {
	kind: PlanEntryKind;
	file: string;
	resolution: PlanResolution;
	reason?: string;
	previousFile?: string;
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
}

export interface ReauthenticateResult {
	appleId: string;
	dsid: string;
	targetDir: string;
}

export function cloneIcloudMd(plugin: IcloudPlugin, targetDir: string, options?: IcloudMdCallOptions) {
	return runIcloudMdJson<CloneSummary>(plugin, ["clone", targetDir], options);
}

export function pullIcloudMd(plugin: IcloudPlugin, targetDir: string, options?: IcloudMdCallOptions) {
	return runIcloudMdJson<PullSummary>(plugin, ["pull", targetDir], options);
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
