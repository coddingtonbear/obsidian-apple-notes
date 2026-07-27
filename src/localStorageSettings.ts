import { Platform, type App } from "obsidian";
import { joinPathEntries, splitPathEntries } from "./cliEnv";
import type IcloudPlugin from "./main";

/**
 * Binary path and PATH additions are machine-specific, so they live in
 * per-installation local storage (obsidian-git's pattern) rather than the
 * synced plugin settings in data.json.
 */
export class LocalStorageSettings {
	private readonly prefix: string;
	private readonly app: App;

	constructor(private readonly plugin: IcloudPlugin) {
		this.prefix = this.plugin.manifest.id + ":";
		this.app = plugin.app;
	}

	getBinaryPath(): string | null {
		return this.app.loadLocalStorage(this.prefix + "binaryPath") as string | null;
	}

	setBinaryPath(value: string): void {
		this.app.saveLocalStorage(this.prefix + "binaryPath", value);
	}

	/** Stored in the platform's own PATH syntax, so the value can be pasted
	 * straight in from (and out to) a shell on that machine. */
	getPathAdditions(): string[] {
		const raw = this.app.loadLocalStorage(this.prefix + "pathAdditions") as string | null;
		return raw ? splitPathEntries(raw, Platform.isWin) : [];
	}

	setPathAdditions(value: string[]): void {
		this.app.saveLocalStorage(this.prefix + "pathAdditions", joinPathEntries(value, Platform.isWin));
	}
}
