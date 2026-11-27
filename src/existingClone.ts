/**
 * Recognising a folder icloud-md has already cloned, so the plugin can
 * reconnect to it instead of insisting on a fresh clone.
 *
 * The plugin's "connected" flag lives in its own data.json; the clone itself
 * lives in the vault folder as `.icloud-md/state.json`. When the former is
 * lost (a reinstall, a vault sync that skips plugin data) and the latter
 * survives, `clone` refuses the folder and - before this module - the only way
 * back was to delete the clone and start over. See
 * https://github.com/coddingtonbear/obsidian-apple-notes/discussions/13.
 *
 * Kept free of any Obsidian import so it can be unit-tested under plain Node:
 * callers supply the vault access through `VaultProbe`.
 */

/** Vault-relative, POSIX-separated path of the clone marker inside a folder. */
export const STATE_FILE = ".icloud-md/state.json";

/** What a found clone tells us about how it was made. */
export interface ExistingClone {
	/** Vault-relative folder holding the clone. */
	folder: string;
	/** Whether the clone was made with `--filename-as-title` - a choice icloud-md
	 * fixes at clone time, so reconnecting has to adopt it rather than ask. */
	filenameAsTitle: boolean;
}

/** The slice of the vault adapter detection needs. Paths are vault-relative. */
export interface VaultProbe {
	/** Reads a file's text, or returns undefined when it doesn't exist or can't be read. */
	readText(path: string): Promise<string | undefined>;
}

/** icloud-md's error name for `clone` into a folder that already holds a clone. */
export const ALREADY_CLONED_ERROR = "AlreadyClonedDirectoryError";

export function stateFilePath(folder: string): string {
	return `${folder.replace(/\/+$/, "")}/${STATE_FILE}`;
}

/**
 * Reads the clone options out of a state.json's text. Layout version 3 records
 * `titleMode` explicitly; icloud-md itself treats anything else as "in-body",
 * and so does this. Returns undefined when the text isn't a JSON object at all
 * - that's not a clone we can trust, and `clone` would refuse the folder
 * anyway, so the caller should fall through to its normal behaviour.
 */
export function parseCloneState(text: string): { filenameAsTitle: boolean } | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return undefined;
	}
	const titleMode = (parsed as { titleMode?: unknown }).titleMode;
	return { filenameAsTitle: titleMode === "filename" };
}

/** The clone in `folder`, if there is one. */
export async function findExistingClone(folder: string, probe: VaultProbe): Promise<ExistingClone | undefined> {
	const trimmed = folder.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	const text = await probe.readText(stateFilePath(trimmed));
	if (text === undefined) {
		return undefined;
	}
	const state = parseCloneState(text);
	return state === undefined ? undefined : { folder: trimmed, ...state };
}

/**
 * Every clone among `folders`, in the order given. Used when the plugin has
 * no folder on record at all - a lost data.json - to offer the user the clone
 * that's already sitting in their vault instead of making them remember
 * where it was.
 */
export async function findExistingClones(folders: readonly string[], probe: VaultProbe): Promise<ExistingClone[]> {
	const found = await Promise.all(folders.map((folder) => findExistingClone(folder, probe)));
	return found.filter((clone): clone is ExistingClone => clone !== undefined);
}
