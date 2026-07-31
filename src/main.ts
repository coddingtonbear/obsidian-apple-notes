import { FileSystemAdapter, Menu, Notice, Plugin, normalizePath } from "obsidian";
import * as nodePath from "node:path";
import { LocalStorageSettings } from "./localStorageSettings";
import { PeriodicSync } from "./periodicSync";
import { CONNECT_HEADLINE, REAUTHENTICATE_HEADLINE, SIGN_IN_PATIENCE } from "./progressMessages";
import { ProgressNotice } from "./progressNotice";
import { DEFAULT_SETTINGS, type IcloudSettings } from "./settings";
import { IcloudSettingTab } from "./settingsTab";
import { IcloudStatusBar } from "./statusBar";
import { SyncQueue } from "./syncQueue";
import {
	cloneIcloudMd,
	pullIcloudMd,
	pushIcloudMd,
	reauthenticateIcloudMd,
	statusIcloudMd,
	type PullSummary,
} from "./icloudMdClient";
import { collectDeferredRenames, performDeferredRenames, type VaultRenamer } from "./deferredRenames";

// Obsidian's plugin review type-checks without @types/node, so node:path resolves
// to `any`; pin join() to an explicit signature to keep the call typed.
const path = nodePath as unknown as { join: (...segments: string[]) => string };

/** Message for something thrown outside icloud-md's structured error contract - a bad vault
 * adapter, a failed settings write. Non-Error throws have no message worth showing, so they get
 * a generic line and the value itself goes to the console for a bug report. */
function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	console.error("Apple Notes sync: unexpected error", error);
	return "an unexpected error occurred (see the developer console)";
}

export type SyncState =
	| { kind: "disconnected" }
	| { kind: "idle"; pendingCount?: number }
	| { kind: "syncing"; label: string }
	| { kind: "error"; message: string };

export default class IcloudPlugin extends Plugin {
	settings: IcloudSettings;
	localStorage: LocalStorageSettings;
	syncState: SyncState = { kind: "disconnected" };

	private readonly syncQueue = new SyncQueue();
	private statusBar: IcloudStatusBar;
	periodicSync: PeriodicSync;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.localStorage = new LocalStorageSettings(this);
		this.syncState = this.settings.connected ? { kind: "idle" } : { kind: "disconnected" };

		this.periodicSync = new PeriodicSync(this);
		this.statusBar = new IcloudStatusBar(this);
		this.addSettingTab(new IcloudSettingTab(this.app, this));

		this.addRibbonIcon("cloud", "Apple Notes sync", (evt) => this.buildActionMenu().showAtMouseEvent(evt));

		this.addConnectedCommand("pull-now", "Pull now", () => this.pull());
		this.addConnectedCommand("push-now", "Push now", () => this.push());
		this.addConnectedCommand("reauthenticate", "Reauthenticate", () => this.reauthenticate());
		this.addConnectedCommand("show-status", "Show status", () => this.showStatus());

		this.periodicSync.reload();
	}

	onunload(): void {
		this.periodicSync?.stop();
	}

	/** Registers a command that only appears/runs while a folder is connected. Using
	 * checkCallback hides it from the command palette when disconnected, rather than
	 * surfacing a "connect first" notice after the fact. */
	private addConnectedCommand(id: string, name: string, action: () => Promise<void>): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				if (!this.settings.connected) {
					return false;
				}
				if (!checking) {
					void action();
				}
				return true;
			},
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<IcloudSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** This plugin is desktop-only, so the adapter is always a FileSystemAdapter. */
	getVaultBasePath(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("Apple Notes Sync requires the desktop file system adapter");
		}
		return adapter.getBasePath();
	}

	getTargetDir(): string {
		return path.join(this.getVaultBasePath(), normalizePath(this.settings.folder));
	}

	buildActionMenu(): Menu {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Pull now").setIcon("download").onClick(() => void this.pull()));
		menu.addItem((item) => item.setTitle("Push now").setIcon("upload").onClick(() => void this.push()));
		menu.addItem((item) =>
			item.setTitle("Reauthenticate").setIcon("key").onClick(() => void this.reauthenticate()),
		);
		menu.addItem((item) => item.setTitle("Show status").setIcon("info").onClick(() => void this.showStatus()));
		return menu;
	}

	/** The settings tab's Connect button - runs `clone`, and on success flips the plugin
	 * into the "connected" state. Returns whether it succeeded, so the settings tab knows
	 * whether to re-render into the connected view. Never throws: the caller has a disabled
	 * button to restore, and an unexpected failure has to reach the user as a notice rather
	 * than as an unhandled rejection in the developer console. */
	async connect(): Promise<boolean> {
		const progress = new ProgressNotice(CONNECT_HEADLINE, SIGN_IN_PATIENCE);
		this.setSyncState({ kind: "syncing", label: "Connecting" });
		try {
			const targetDir = this.getTargetDir();
			const result = await this.syncQueue.run(() => cloneIcloudMd(this, targetDir, progress.callOptions));
			if (result.ok === false) {
				return this.reportFailure("connect", result.error.message);
			}
			this.settings.connected = true;
			await this.saveSettings();
			this.periodicSync.reload();
			new Notice(`Apple Notes: cloned ${result.data.written} note(s) into ${this.settings.folder}.`);
			this.setSyncState({ kind: "idle" });
			return true;
		} catch (error) {
			return this.reportFailure("connect", errorMessage(error));
		} finally {
			progress.hide();
		}
	}

	/** Plugin-local only: forgets the binding and stops auto-sync. Leaves the cloned files
	 * and iCloud-side auth untouched. */
	disconnect(): void {
		this.settings.connected = false;
		void this.saveSettings();
		this.periodicSync.reload();
		this.setSyncState({ kind: "disconnected" });
	}

	/** `quiet` (used by auto-sync) suppresses the success notice when nothing changed, so
	 * the interval only surfaces a popup when it actually moved a note or hit an error. */
	async pull(options: { quiet?: boolean } = {}): Promise<void> {
		if (!this.requireConnected()) {
			return;
		}
		this.setSyncState({ kind: "syncing", label: "Pulling" });
		const result = await this.syncQueue.run(() => pullIcloudMd(this, this.getTargetDir()));
		if (result.ok === false) {
			new Notice(`Apple Notes pull failed: ${result.error.message}`);
			this.setSyncState({ kind: "error", message: result.error.message });
			return;
		}
		const renamed = await this.performDeferredRenames(result.data.changes);
		const { added, updated, removed } = result.data;
		if (!options.quiet || added + updated + removed + renamed > 0) {
			const renameSuffix = renamed > 0 ? `, ${renamed} renamed` : "";
			new Notice(`Apple Notes pull: ${added} added, ${updated} updated, ${removed} removed${renameSuffix}.`);
		}
		await this.refreshStatus();
	}

	/** Pull runs with `--defer-renames`, so a remote retitle leaves the file
	 * where it was and reports the rename it wanted; carrying it out through
	 * Obsidian's file manager here is what keeps wikilinks pointing at the
	 * note. icloud-md recognises the completed rename by note id on its next
	 * run, and keeps re-reporting any we couldn't perform - so a blocked or
	 * failed rename only needs a notice, not recovery. Returns how many were
	 * performed. */
	private async performDeferredRenames(changes: PullSummary["changes"]): Promise<number> {
		const renames = collectDeferredRenames(changes, normalizePath(this.settings.folder));
		if (renames.length === 0) {
			return 0;
		}
		const vault: VaultRenamer = {
			exists: (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null,
			rename: async (from, to) => {
				const file = this.app.vault.getAbstractFileByPath(normalizePath(from));
				if (file === null) {
					throw new Error("the file is no longer there");
				}
				await this.app.fileManager.renameFile(file, normalizePath(to));
			},
		};
		const outcome = await performDeferredRenames(renames, vault);
		for (const blocked of outcome.blocked) {
			new Notice(`Apple Notes: "${blocked.from}" should become "${blocked.to}", but something already has that name.`);
		}
		for (const failed of outcome.failed) {
			new Notice(`Apple Notes: renaming "${failed.rename.from}" to "${failed.rename.to}" failed: ${failed.message}`);
		}
		return outcome.performed.length;
	}

	async push(options: { quiet?: boolean } = {}): Promise<void> {
		if (!this.requireConnected()) {
			return;
		}
		this.setSyncState({ kind: "syncing", label: "Pushing" });
		const result = await this.syncQueue.run(() => pushIcloudMd(this, this.getTargetDir()));
		if (result.ok === false) {
			new Notice(`Apple Notes push failed: ${result.error.message}`);
			this.setSyncState({ kind: "error", message: result.error.message });
			return;
		}
		const pushed = result.data.pushed ?? 0;
		if (!options.quiet || pushed > 0) {
			new Notice(`Apple Notes push: ${pushed} note(s) pushed.`);
		}
		await this.refreshStatus();
	}

	async reauthenticate(): Promise<void> {
		if (!this.requireConnected()) {
			return;
		}
		const progress = new ProgressNotice(REAUTHENTICATE_HEADLINE, SIGN_IN_PATIENCE);
		try {
			const result = await this.syncQueue.run(() =>
				reauthenticateIcloudMd(this, this.getTargetDir(), progress.callOptions),
			);
			if (result.ok === false) {
				new Notice(`Apple Notes reauthenticate failed: ${result.error.message}`);
				return;
			}
			new Notice(`Apple Notes: reauthenticated as ${result.data.appleId}.`);
		} catch (error) {
			new Notice(`Apple Notes reauthenticate failed: ${errorMessage(error)}`);
		} finally {
			progress.hide();
		}
	}

	async showStatus(): Promise<void> {
		if (!this.requireConnected()) {
			return;
		}
		await this.refreshStatus();
		const state = this.syncState;
		if (state.kind === "idle") {
			new Notice(
				state.pendingCount
					? `Apple Notes: ${state.pendingCount} change(s) pending.`
					: "Apple Notes: up to date.",
			);
		} else if (state.kind === "error") {
			new Notice(`Apple Notes: ${state.message}`);
		}
	}

	/** Called on the auto-sync interval - pull then push, both through the same queue every
	 * manual action uses, so a scheduled and a manual run never overlap. */
	async runAutoSync(): Promise<void> {
		if (!this.settings.connected) {
			return;
		}
		await this.pull({ quiet: true });
		await this.push({ quiet: true });
	}

	private async refreshStatus(): Promise<void> {
		const result = await this.syncQueue.run(() => statusIcloudMd(this, this.getTargetDir()));
		if (result.ok === false) {
			this.setSyncState({ kind: "error", message: result.error.message });
			return;
		}
		this.setSyncState({ kind: "idle", pendingCount: result.data.entries.length });
	}

	/** Surfaces a failed action the same way whether icloud-md reported it or something
	 * unexpected threw. Returns false so `connect()` can `return this.reportFailure(...)`. */
	private reportFailure(action: string, message: string): false {
		new Notice(`Apple Notes ${action} failed: ${message}`);
		this.setSyncState({ kind: "error", message });
		return false;
	}

	private requireConnected(): boolean {
		if (!this.settings.connected) {
			new Notice("Apple Notes: connect a folder first (see plugin settings).");
			return false;
		}
		return true;
	}

	private setSyncState(state: SyncState): void {
		this.syncState = state;
		this.statusBar?.refresh();
	}
}
