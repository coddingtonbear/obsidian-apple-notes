export interface IcloudSettings {
	/** Vault-relative folder cloned into / synced with Apple Notes. */
	folder: string;
	/** Clone with `--filename-as-title`: each file is named for its note's title and holds only
	 * the body, instead of repeating the title as the file's first line. A whole-vault choice
	 * icloud-md only accepts at clone time, so it locks once connected. */
	filenameAsTitle: boolean;
	/** Plugin-local "bound" flag - set once `clone` succeeds, cleared by Disconnect. Leaves the cloned files and iCloud-side auth untouched either way. */
	connected: boolean;
	autoSyncEnabled: boolean;
	autoSyncIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: IcloudSettings = {
	folder: "",
	filenameAsTitle: false,
	connected: false,
	autoSyncEnabled: false,
	autoSyncIntervalMinutes: 30,
};
