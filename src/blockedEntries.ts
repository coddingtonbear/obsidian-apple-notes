import { vaultPath } from "./deferredRenames";
import type { PlanEntryKind, PlanResolution, SerializedPlanEntry } from "./icloudMdClient";

/** A local change icloud-md will not push until the user does something:
 * "refused" means the markdown has no Apple Notes equivalent, "conflict"
 * means the note also changed remotely. Either way it isn't *pending* - no
 * amount of waiting or re-running push moves it - so it must not be counted
 * with the changes that are merely queued. */
export interface BlockedEntry {
	/** Vault-relative path, so it can be matched against open files. */
	file: string;
	/** The same note relative to the sync folder - what icloud-md's own
	 * commands (`restore`) take. */
	syncFile: string;
	kind: PlanEntryKind;
	resolution: Extract<PlanResolution, "refused" | "conflict">;
	reason: string;
}

/** Whether `icloud-md restore` is the way out: it rewrites a *tracked* note
 * from its last synced copy, which only answers a blocked edit. A refused
 * create has no synced copy to go back to, a stuck rename or move is about
 * where the file is rather than what it says, and a refused delete has no
 * file to put the banner on. */
export function canRestore(entry: BlockedEntry): boolean {
	return entry.kind === "update";
}

export interface PlanSummary {
	/** Entries push will carry out next time it runs. */
	pendingCount: number;
	blocked: BlockedEntry[];
}

const BLOCKED_RESOLUTIONS: ReadonlySet<PlanResolution> = new Set(["refused", "conflict"]);

function isBlocked(resolution: PlanResolution): resolution is BlockedEntry["resolution"] {
	return BLOCKED_RESOLUTIONS.has(resolution);
}

/** Splits a status/push plan into what's queued and what's stuck. "noop"
 * entries are neither - icloud-md lists them for completeness, but they
 * describe nothing the user needs to know about. An entry with no reason
 * gets a generic one rather than being dropped: a blocked file with an
 * unexplained block is still blocked. */
export function summarizePlan(entries: readonly SerializedPlanEntry[], folder: string): PlanSummary {
	const summary: PlanSummary = { pendingCount: 0, blocked: [] };
	for (const entry of entries) {
		if (isBlocked(entry.resolution)) {
			summary.blocked.push({
				file: vaultPath(folder, entry.file),
				syncFile: entry.file,
				kind: entry.kind,
				resolution: entry.resolution,
				reason: entry.reason ?? `icloud-md reported this change as ${entry.resolution} without saying why`,
			});
		} else if (entry.resolution === "ready") {
			summary.pendingCount += 1;
		}
	}
	return summary;
}

/** What the user has already been told, file -> reason. */
export type AnnouncedBlocks = ReadonlyMap<string, string>;

/** The blocked entries worth a notice this time round. Status is re-read on
 * every auto-sync cycle, so announcing all of them each time would turn one
 * stuck note into a drumbeat; instead a file is announced once per reason,
 * and again only if it clears and re-blocks or the reason changes. The
 * returned map replaces the caller's: a file that is no longer blocked
 * drops out, so its next block is news again. */
export function unannouncedBlocks(
	announced: AnnouncedBlocks,
	blocked: readonly BlockedEntry[],
): { fresh: BlockedEntry[]; announced: AnnouncedBlocks } {
	const fresh: BlockedEntry[] = [];
	const next = new Map<string, string>();
	for (const entry of blocked) {
		if (announced.get(entry.file) !== entry.reason) {
			fresh.push(entry);
		}
		next.set(entry.file, entry.reason);
	}
	return { fresh, announced: next };
}

const THE_FILE = (entry: BlockedEntry): string => `"${entry.file}"`;

/** One sentence for a notice about a blocked file. The reason is icloud-md's
 * own wording, verbatim: it names the construct and, for a refusal, the
 * restore command that discards the edit. */
export function describeBlock(entry: BlockedEntry): string {
	const verb = entry.resolution === "conflict" ? "conflicts with Apple Notes" : "can't be pushed";
	return `${THE_FILE(entry)} ${verb}: ${entry.reason}`;
}

/** The status bar tooltip for an idle connection - blocked files first,
 * since they need the user, then whatever is merely queued. */
export function describeIdle(summary: PlanSummary): string {
	const parts: string[] = [];
	if (summary.blocked.length > 0) {
		const names = summary.blocked.map(THE_FILE).join(", ");
		parts.push(`${summary.blocked.length} note(s) can't sync: ${names}`);
	}
	if (summary.pendingCount > 0) {
		parts.push(`${summary.pendingCount} change(s) pending`);
	}
	return parts.length > 0 ? parts.join("; ") : "up to date";
}
