import { Notice, Platform, PluginSettingTab, type App, type Setting, type SettingDefinitionItem } from "obsidian";
import { joinPathEntries, splitPathEntries } from "./cliEnv";
import type { ExistingClone } from "./existingClone";
import { versionIcloudMd } from "./icloudMdClient";
import type IcloudPlugin from "./main";
import { assessVersion, MINIMUM_ICLOUD_MD_VERSION, type VersionAssessment } from "./versionCheck";

export class IcloudSettingTab extends PluginSettingTab {
	/** Result of the icloud-md version probe, cached for as long as the tab
	 * stays open; hide() clears it so the next open re-checks (the user
	 * plausibly just updated icloud-md). Null until a probe completes. */
	private versionAssessment: VersionAssessment | null = null;
	private versionCheckInFlight = false;
	/** While disconnected: the icloud-md clone found in the chosen folder (or,
	 * with no folder chosen, the first one found anywhere in the vault). Drives
	 * the Connect row's switch to "Use existing clone". Re-probed whenever the
	 * folder field changes; cleared by hide(). */
	private existingClone: ExistingClone | undefined = undefined;
	/** Identifies the latest probe so a slow earlier one can't overwrite its result. */
	private cloneProbeSerial = 0;

	constructor(
		app: App,
		private readonly plugin: IcloudPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		this.ensureVersionChecked();
		if (!this.plugin.settings.connected && this.cloneProbeSerial === 0) {
			void this.probeExistingClone();
		}
		const items: SettingDefinitionItem[] = this.plugin.settings.connected
			? this.connectedDefinitions()
			: this.notConnectedDefinitions();
		const warning = this.versionWarningDefinition();
		if (warning) {
			items.unshift(warning);
		}
		items.push(this.advancedGroup());
		return items;
	}

	hide(): void {
		this.versionAssessment = null;
		this.existingClone = undefined;
		this.cloneProbeSerial = 0;
		super.hide();
	}

	/** While a clone is detected, the folder and title-mode controls show the
	 * clone's own values - the folder when none is chosen yet, the title mode
	 * always, since reconnecting has to adopt it. Nothing is persisted until
	 * the user clicks "Use existing clone". */
	getControlValue(key: string): unknown {
		const clone = this.plugin.settings.connected ? undefined : this.existingClone;
		if (clone && key === "folder" && this.plugin.settings.folder.trim().length === 0) {
			return clone.folder;
		}
		if (clone && key === "filenameAsTitle") {
			return clone.filenameAsTitle;
		}
		return super.getControlValue(key);
	}

	/** Looks for a clone in the chosen folder - or anywhere in the vault when
	 * no folder is chosen - and re-renders only when the answer changes, so
	 * typing a folder name doesn't redraw the tab under the cursor. */
	private async probeExistingClone(): Promise<void> {
		const serial = ++this.cloneProbeSerial;
		const folder = this.plugin.settings.folder.trim();
		const found =
			folder.length > 0
				? await this.plugin.findExistingClone(folder)
				: (await this.plugin.findExistingClones())[0];
		if (serial !== this.cloneProbeSerial || this.plugin.settings.connected) {
			return;
		}
		const changed =
			found?.folder !== this.existingClone?.folder ||
			found?.filenameAsTitle !== this.existingClone?.filenameAsTitle;
		this.existingClone = found;
		if (changed) {
			this.update();
		}
	}

	/** Starts one version probe per tab open. Deliberately not routed through the
	 * sync queue: `--version` touches no state, and the warning shouldn't have to
	 * wait behind a long pull. Warn-only - nothing is gated on the outcome. */
	private ensureVersionChecked(): void {
		if (this.versionAssessment !== null || this.versionCheckInFlight) {
			return;
		}
		this.versionCheckInFlight = true;
		void versionIcloudMd(this.plugin).then((result) => {
			this.versionCheckInFlight = false;
			this.versionAssessment = assessVersion(result);
			if (this.versionWarningDefinition() !== null) {
				this.update();
			}
		});
	}

	private versionWarningDefinition(): SettingDefinitionItem | null {
		const markWarning = (setting: Setting) => setting.nameEl.addClass("mod-warning");
		switch (this.versionAssessment?.kind) {
			case "outdated":
				return {
					name: "icloud-md needs an update",
					desc:
						`Version ${this.versionAssessment.version} was found, but this plugin expects ` +
						`${MINIMUM_ICLOUD_MD_VERSION} or newer. Syncing may still work, but some notes may not ` +
						"sync correctly. Update with: npm install -g icloud-md",
					render: markWarning,
				};
			case "unknown":
				return {
					name: "icloud-md version could not be determined",
					desc:
						"icloud-md ran but didn't report a readable version, which usually means a release older " +
						`than this plugin expects (${MINIMUM_ICLOUD_MD_VERSION} or newer). ` +
						"Update with: npm install -g icloud-md",
					render: markWarning,
				};
			default:
				// ok, unavailable (a missing binary is surfaced elsewhere), or still probing.
				return null;
		}
	}

	/** Persist control changes and run the side effects the old onChange handlers did. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case "folder":
				this.plugin.settings.folder = value as string;
				await this.plugin.saveSettings();
				void this.probeExistingClone();
				return;
			case "filenameAsTitle":
				this.plugin.settings.filenameAsTitle = value as boolean;
				await this.plugin.saveSettings();
				return;
			case "autoSyncEnabled":
				this.plugin.settings.autoSyncEnabled = value as boolean;
				await this.plugin.saveSettings();
				this.plugin.periodicSync.reload();
				// Re-render so the interval field appears/disappears.
				this.update();
				return;
			case "autoSyncIntervalMinutes":
				this.plugin.settings.autoSyncIntervalMinutes = value as number;
				await this.plugin.saveSettings();
				this.plugin.periodicSync.reload();
				return;
		}
	}

	private notConnectedDefinitions(): SettingDefinitionItem[] {
		const clone = this.existingClone;
		return [
			{
				name: "Vault folder",
				desc: clone
					? `An existing Apple Notes clone was found in "${clone.folder}". Use it below, or name a different folder.`
					: "Vault-relative folder to sync. A new or empty folder gets cloned into; a folder that already " +
						"holds an icloud-md clone gets reconnected to as it is.",
				control: { type: "text", key: "folder", placeholder: "Apple Notes" },
			},
			{
				name: "Use filename as title",
				desc: clone
					? "Fixed by the existing clone - icloud-md only accepts this choice at clone time, so reconnecting " +
						"keeps whatever the clone was made with."
					: "Names each file after its note's title, the way Obsidian expects - a retitle in Apple Notes then " +
						"renames the file (with wikilinks rewritten), and renaming a file retitles the note. Off keeps " +
						"the title as the file's first line instead. A whole-vault choice icloud-md only accepts at " +
						"clone time, so it can't be changed after connecting.",
				control: { type: "toggle", key: "filenameAsTitle", disabled: () => this.existingClone !== undefined },
			},
			clone ? this.useExistingCloneDefinition(clone) : this.connectDefinition(),
		];
	}

	private connectDefinition(): SettingDefinitionItem {
		return {
			name: "Connect",
			desc: "Runs `icloud-md clone` into the folder above - this opens the iCloud sign-in browser window.",
			render: (setting: Setting) => {
				setting.addButton((button) =>
					button
						.setButtonText("Connect")
						.setCta()
						.onClick(async () => {
							if (!this.plugin.settings.folder.trim()) {
								new Notice("Choose a vault folder first.");
								return;
							}
							button.setDisabled(true).setButtonText("Connecting...");
							let success = false;
							try {
								success = await this.plugin.connect();
							} finally {
								// connect() reports its own failures and shouldn't throw, but a
								// button left disabled by something it didn't anticipate would
								// strand the settings pane with no way to retry.
								if (success) {
									this.update();
								} else {
									button.setDisabled(false).setButtonText("Connect");
								}
							}
						}),
				);
			},
		};
	}

	/** Replaces Connect while a clone is detected: reconnects to it without
	 * cloning, then pulls. The way back for anyone whose plugin settings were
	 * lost while the cloned folder survived (a reinstall, a vault sync that
	 * skips plugin data). */
	private useExistingCloneDefinition(clone: ExistingClone): SettingDefinitionItem {
		return {
			name: "Use existing clone",
			desc:
				`Reconnects to the clone already in "${clone.folder}" - no re-clone, and no sign-in window unless ` +
				"the saved iCloud session has expired - then pulls to bring it up to date.",
			render: (setting: Setting) => {
				setting.addButton((button) =>
					button
						.setButtonText("Use existing clone")
						.setCta()
						.onClick(async () => {
							button.setDisabled(true).setButtonText("Reconnecting...");
							let success = false;
							try {
								success = await this.plugin.adoptExistingClone(clone);
							} finally {
								if (success) {
									this.update();
								} else {
									button.setDisabled(false).setButtonText("Use existing clone");
								}
							}
						}),
				);
			},
		};
	}

	private connectedDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Vault folder",
				desc: "Connected. Disconnect to change it.",
				control: { type: "text", key: "folder", disabled: true },
			},
			{
				name: "Use filename as title",
				desc: "Connected. Disconnect to change it.",
				control: { type: "toggle", key: "filenameAsTitle", disabled: true },
			},
			{
				name: "Sync now",
				render: (setting: Setting) => {
					setting
						.addButton((button) => button.setButtonText("Pull").onClick(() => void this.plugin.pull()))
						.addButton((button) => button.setButtonText("Push").onClick(() => void this.plugin.push()));
				},
			},
			{
				name: "Reauthenticate",
				desc: "Force a fresh iCloud sign-in for this folder.",
				render: (setting: Setting) => {
					setting.addButton((button) =>
						button.setButtonText("Reauthenticate").onClick(() => void this.plugin.reauthenticate()),
					);
				},
			},
			{
				name: "Disconnect",
				desc: "Forgets this binding and stops auto-sync. Leaves the cloned files and icloud-side auth untouched.",
				render: (setting: Setting) => {
					setting.addButton((button) => {
						// setWarning() is deprecated and its replacement setDestructive() is 1.13.0+;
						// apply the styling class directly to keep this render helper self-contained.
						button.buttonEl.addClass("mod-warning");
						button.setButtonText("Disconnect").onClick(() => {
							this.plugin.disconnect();
							this.update();
						});
					});
				},
			},
			{
				name: "Sync automatically",
				desc: "Off by default. When enabled, pulls then pushes on the interval below.",
				control: { type: "toggle", key: "autoSyncEnabled" },
			},
			{
				name: "Auto-sync interval",
				desc: "Minutes between automatic pull-then-push runs.",
				visible: () => this.plugin.settings.autoSyncEnabled,
				control: {
					type: "number",
					key: "autoSyncIntervalMinutes",
					min: 1,
					validate: (value: number) =>
						Number.isFinite(value) && value >= 1 ? undefined : "Enter a whole number of minutes (1 or more).",
				},
			},
		];
	}

	private advancedGroup(): SettingDefinitionItem {
		return {
			type: "group",
			heading: "Advanced",
			items: [
				{
					name: "icloud-md binary location",
					desc: "Leave blank to use `icloud-md` on PATH. Set this if Obsidian can't find a globally-installed binary.",
					render: (setting: Setting) => {
						setting.addText((text) =>
							text
								.setPlaceholder("icloud-md")
								.setValue(this.plugin.localStorage.getBinaryPath() ?? "")
								.onChange((value) => this.plugin.localStorage.setBinaryPath(value)),
						);
					},
				},
				{
					name: "Extra PATH entries",
					desc:
						`${Platform.isWin ? "Semicolon" : "Colon"}-separated directories to prepend to PATH when spawning ` +
						"icloud-md, such as wherever npm or your Node version manager installs global binaries. " +
						"GUI-launched Obsidian doesn't inherit your shell's PATH.",
					render: (setting: Setting) => {
						setting.addText((text) =>
							text
								.setPlaceholder(
									Platform.isWin
										? String.raw`C:\Users\you\AppData\Roaming\npm`
										: "/usr/local/bin:/opt/homebrew/bin",
								)
								.setValue(joinPathEntries(this.plugin.localStorage.getPathAdditions(), Platform.isWin))
								.onChange((value) =>
									this.plugin.localStorage.setPathAdditions(splitPathEntries(value, Platform.isWin)),
								),
						);
					},
				},
			],
		};
	}
}
