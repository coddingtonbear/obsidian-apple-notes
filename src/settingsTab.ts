import { Notice, Platform, PluginSettingTab, type App, type Setting, type SettingDefinitionItem } from "obsidian";
import { joinPathEntries, splitPathEntries } from "./cliEnv";
import type IcloudPlugin from "./main";

export class IcloudSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: IcloudPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = this.plugin.settings.connected
			? this.connectedDefinitions()
			: this.notConnectedDefinitions();
		items.push(this.advancedGroup());
		return items;
	}

	/** Persist control changes and run the side effects the old onChange handlers did. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case "folder":
				this.plugin.settings.folder = value as string;
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
								const success = await this.plugin.connect();
								if (success) {
									this.update();
								} else {
									button.setDisabled(false).setButtonText("Connect");
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
