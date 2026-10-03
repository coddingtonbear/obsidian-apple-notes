import type { BlockedEntry } from "./blockedEntries";

/** Blocks the user has waved away, file -> the reason they dismissed. A
 * dismissal is for one reason only: a file that re-blocks for a different
 * reason, or that clears and blocks again, gets its banner back. */
export type Dismissals = ReadonlyMap<string, string>;

/** Drops dismissals for files no longer blocked (or blocked differently), so
 * the map never grows past the current blocked set. */
export function pruneDismissals(dismissed: Dismissals, blocked: readonly BlockedEntry[]): Dismissals {
	const next = new Map<string, string>();
	for (const entry of blocked) {
		if (dismissed.get(entry.file) === entry.reason) {
			next.set(entry.file, entry.reason);
		}
	}
	return next;
}

export function dismiss(dismissed: Dismissals, entry: BlockedEntry): Dismissals {
	return new Map(dismissed).set(entry.file, entry.reason);
}

/** The block a banner should show for an open file, if any: the file is
 * blocked and the user hasn't dismissed this particular reason. */
export function bannerFor(
	blocked: readonly BlockedEntry[],
	dismissed: Dismissals,
	filePath: string,
): BlockedEntry | undefined {
	const entry = blocked.find((candidate) => candidate.file === filePath);
	if (entry === undefined || dismissed.get(entry.file) === entry.reason) {
		return undefined;
	}
	return entry;
}
