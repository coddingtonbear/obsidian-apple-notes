import { Notice, Platform, PluginSettingTab, type App, type Setting, type SettingDefinitionItem } from "obsidian";
import { joinPathEntries, splitPathEntries } from "./cliEnv";
import { versionIcloudMd } from "./icloudMdClient";
import type IcloudPlugin from "./main";
import { assessVersion, MINIMUM_ICLOUD_MD_VERSION, type VersionAssessment } from "./versionCheck";

export class IcloudSettingTab extends PluginSettingTab {
	/** Result of the icloud-md version probe, cached for as long as the tab
	 * stays open; hide() clears it so the next open re-checks (the user
	 * plausibly just updated icloud-md). Null until a probe completes. */
	private versionAssessment: VersionAssessment | null = null;
	private versionCheckInFlight = false;

	constructor(
		app: App,
		private readonly plugin: IcloudPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		this.ensureVersionChecked();
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
		super.hide();
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
						`${MINIMUM_ICLOUD_MD_VERSION} or newer. Syncing may still work, but renames from Apple Notes ` +
						"won't be handled properly. Update with: npm install -g icloud-md",
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
		return [
			{
				name: "Vault folder",
				desc: "Vault-relative folder to clone into. Choose an empty or new folder - `clone` creates it if missing but refuses one it's already bound to.",
				control: { type: "text", key: "folder", placeholder: "Apple Notes" },
			},
			{
				name: "Use filename as title",
				desc:
					"Names each file after its note's title, the way Obsidian expects - a retitle in Apple Notes then " +
					"renames the file (with wikilinks rewritten), and renaming a file retitles the note. Off keeps " +
					"the title as the file's first line instead. A whole-vault choice icloud-md only accepts at " +
					"clone time, so it can't be changed after connecting.",
				control: { type: "toggle", key: "filenameAsTitle" },
			},
			{
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
			},
		];
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
