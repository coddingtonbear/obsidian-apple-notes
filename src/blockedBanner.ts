import { ButtonComponent, MarkdownView, Modal, setIcon } from "obsidian";
import { bannerFor, dismiss, pruneDismissals, type Dismissals } from "./bannerState";
import { canRestore, type BlockedEntry } from "./blockedEntries";
import type IcloudPlugin from "./main";

const BANNER_CLASS = "icloud-blocked-banner";

/** A strip between a note's header and its editor, shown while icloud-md
 * refuses to push that note, saying why and offering the way out. The status
 * bar and notices say *that* something is stuck; this says so on the note
 * itself, where the user is looking when they wonder why their edit never
 * reached Apple Notes.
 *
 * Banners are reconciled, not stacked: every refresh walks the open markdown
 * views and makes each one's banner match the current blocked set - added,
 * updated in place when the reason changes, removed when the block clears
 * or the view moves to another file. */
export class BlockedBanners {
	private dismissed: Dismissals = new Map();
	/** The blocked set as of the last successful status read. Held through
	 * "syncing" and "error" states, which say nothing about what's blocked:
	 * treating them as "nothing blocked" would drop every banner (and every
	 * dismissal) for the duration of each auto-sync and bring them back
	 * afterwards. Cleared on disconnect, where it genuinely means nothing. */
	private blocked: readonly BlockedEntry[] = [];

	constructor(private readonly plugin: IcloudPlugin) {
		const { workspace } = plugin.app;
		// file-open covers the active leaf changing file; layout-change covers
		// leaves opening, closing, and splitting, which file-open doesn't fire for.
		plugin.registerEvent(workspace.on("file-open", () => this.refresh()));
		plugin.registerEvent(workspace.on("layout-change", () => this.refresh()));
		plugin.register(() => this.removeAll());
		workspace.onLayoutReady(() => this.refresh());
	}

	refresh(): void {
		const state = this.plugin.syncState;
		if (state.kind === "idle") {
			this.blocked = state.blocked;
		} else if (state.kind === "disconnected") {
			this.blocked = [];
		}
		this.dismissed = pruneDismissals(this.dismissed, this.blocked);
		for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) {
				continue;
			}
			const entry = view.file === null ? undefined : bannerFor(this.blocked, this.dismissed, view.file.path);
			this.reconcile(view, entry);
		}
	}

	private reconcile(view: MarkdownView, entry: BlockedEntry | undefined): void {
		const existing = view.containerEl.querySelector<HTMLElement>(`:scope > .${BANNER_CLASS}`);
		if (entry === undefined) {
			existing?.remove();
			return;
		}
		if (existing?.dataset.reason === entry.reason && existing.dataset.file === entry.file) {
			return;
		}
		existing?.remove();
		view.containerEl.insertBefore(this.build(entry), view.contentEl);
	}

	private build(entry: BlockedEntry): HTMLElement {
		const banner = createDiv({ cls: BANNER_CLASS });
		banner.dataset.file = entry.file;
		banner.dataset.reason = entry.reason;
		setIcon(banner.createSpan({ cls: "icloud-blocked-banner-icon" }), "alert-triangle");

		const text = banner.createDiv({ cls: "icloud-blocked-banner-text" });
		text.createDiv({
			cls: "icloud-blocked-banner-headline",
			text:
				entry.resolution === "conflict"
					? "This note conflicts with Apple Notes."
					: "Apple Notes can't take this edit.",
		});
		text.createDiv({ cls: "icloud-blocked-banner-reason", text: entry.reason });

		const actions = banner.createDiv({ cls: "icloud-blocked-banner-actions" });
		if (canRestore(entry)) {
			new ButtonComponent(actions)
				.setButtonText("Discard local edit")
				.setDestructive()
				.onClick(() => new ConfirmDiscardModal(this.plugin, entry).open());
		}
		new ButtonComponent(actions).setButtonText("Dismiss").onClick(() => {
			this.dismissed = dismiss(this.dismissed, entry);
			this.refresh();
		});
		return banner;
	}

	/** On unload: every view keeps its banner otherwise, since the elements are
	 * ours rather than the view's. Walking the leaves (not `document`) reaches
	 * popout windows too. */
	private removeAll(): void {
		for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView) {
				this.reconcile(leaf.view, undefined);
			}
		}
	}
}

/** One more click before throwing an edit away: the banner's button is a
 * single click on something the user may not have read yet. */
class ConfirmDiscardModal extends Modal {
	constructor(
		private readonly plugin: IcloudPlugin,
		private readonly entry: BlockedEntry,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle("Discard local edit?");
		this.contentEl.createEl("p", {
			text: `"${this.entry.file}" will be rewritten to match the last copy synced with Apple Notes. Everything changed since then is lost.`,
		});
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(buttons)
			.setButtonText("Discard")
			.setDestructive()
			.setCta()
			.onClick(() => {
				this.close();
				void this.plugin.restoreNote(this.entry);
			});
		new ButtonComponent(buttons).setButtonText("Keep editing").onClick(() => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
