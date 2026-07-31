/** Carrying out the renames a `pull --defer-renames` left for us.
 *
 * In a filename-as-title vault a remote retitle has to rename the note's
 * file, but a rename done behind Obsidian's back leaves every wikilink
 * pointing at the old name. So pull is asked to defer: it reports each
 * rename it wanted as a `pendingRename` on the change, and this module maps
 * those into vault paths and performs them through Obsidian's file manager,
 * which rewrites links as it goes. icloud-md notices the completed rename on
 * its next run by note id, so nothing needs to be reported back.
 *
 * Kept free of any Obsidian import (the performer works through the
 * `VaultRenamer` interface) so it can be unit-tested under plain Node.
 */

import type { PullChange, SerializedPlanEntry } from "./icloudMdClient";

/** One rename pull asked for, in vault-relative paths. */
export interface DeferredRename {
	from: string;
	to: string;
}

/** icloud-md reports paths relative to the sync folder, POSIX-separated; a
 * vault path is the same thing with the sync folder prefixed. */
function vaultPath(folder: string, file: string): string {
	const trimmed = folder.replace(/\/+$/, "");
	return trimmed.length === 0 ? file : `${trimmed}/${file}`;
}

/** The renames a pull summary asks us to perform, in the order pull reported
 * them. `folder` is the vault-relative sync folder from settings. */
export function collectDeferredRenames(changes: readonly PullChange[] | undefined, folder: string): DeferredRename[] {
	const renames: DeferredRename[] = [];
	for (const change of changes ?? []) {
		if (change.pendingRename !== undefined && change.pendingRename !== change.file) {
			renames.push({ from: vaultPath(folder, change.file), to: vaultPath(folder, change.pendingRename) });
		}
	}
	return renames;
}

/** The renames a status listing says are still outstanding. Pull is
 * incremental and only re-reports a deferred rename when the note changes
 * remotely again - so one left behind by a `pull --defer-renames` outside the
 * plugin (or one we couldn't perform earlier) would otherwise sit unresolved
 * indefinitely. Status rebuilds its plan from tracked state every run and
 * lists every outstanding rename, which makes any status refresh a chance to
 * finish them and get back to a clean slate. */
export function collectStatusRenames(
	entries: readonly SerializedPlanEntry[] | undefined,
	folder: string,
): DeferredRename[] {
	const renames: DeferredRename[] = [];
	for (const entry of entries ?? []) {
		if (entry.kind === "rename" && entry.pendingRename !== undefined && entry.pendingRename !== entry.file) {
			renames.push({ from: vaultPath(folder, entry.file), to: vaultPath(folder, entry.pendingRename) });
		}
	}
	return renames;
}

/** The slice of Obsidian's vault/file-manager API the performer needs. */
export interface VaultRenamer {
	/** Whether anything (file or folder) exists at this vault path. */
	exists(path: string): boolean;
	/** Rename the file at `from` to `to`, updating links. Rejects if `from`
	 * doesn't exist or isn't a file. */
	rename(from: string, to: string): Promise<void>;
}

export interface DeferredRenameOutcome {
	performed: DeferredRename[];
	/** Something else already sits at the target path. Left alone on purpose:
	 * icloud-md keeps the rename pending, status keeps listing it, and the
	 * sweep retries it on every refresh - so skipping here loses nothing. */
	blocked: DeferredRename[];
	/** The source file wasn't where pull said it was (or the rename threw) -
	 * likely moved or deleted between pull finishing and us getting here.
	 * icloud-md's next run reconciles it either way. */
	failed: { rename: DeferredRename; message: string }[];
}

export async function performDeferredRenames(
	renames: readonly DeferredRename[],
	vault: VaultRenamer,
): Promise<DeferredRenameOutcome> {
	const outcome: DeferredRenameOutcome = { performed: [], blocked: [], failed: [] };
	for (const rename of renames) {
		if (vault.exists(rename.to)) {
			outcome.blocked.push(rename);
			continue;
		}
		try {
			await vault.rename(rename.from, rename.to);
			outcome.performed.push(rename);
		} catch (error) {
			outcome.failed.push({ rename, message: error instanceof Error ? error.message : String(error) });
		}
	}
	return outcome;
}
