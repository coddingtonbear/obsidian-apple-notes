import { setIcon } from "obsidian";
import { describeIdle } from "./blockedEntries";
import type IcloudPlugin from "./main";

/** Connection + outstanding-change indicator, fed by `icloud-md status --json`. Click opens
 * the same Pull now/Push now/Reauthenticate/Show status menu as the ribbon icon. */
export class IcloudStatusBar {
	private readonly el: HTMLElement;

	constructor(private readonly plugin: IcloudPlugin) {
		this.el = plugin.addStatusBarItem();
		this.el.addClass("mod-clickable");
		this.el.onClickEvent((evt) => this.plugin.buildActionMenu().showAtMouseEvent(evt));
		this.refresh();
	}

	refresh(): void {
		const { el } = this;
		el.empty();
		const iconEl = el.createSpan();
		const textEl = el.createSpan({ cls: "icloud-status-bar-text" });

		const state = this.plugin.syncState;
		switch (state.kind) {
			case "disconnected":
				setIcon(iconEl, "cloud-off");
				el.ariaLabel = "Apple Notes sync: not connected";
				break;
			case "syncing":
				setIcon(iconEl, "refresh-cw");
				el.ariaLabel = `Apple notes sync: ${state.label}...`;
				break;
			case "error":
				setIcon(iconEl, "alert-triangle");
				el.ariaLabel = `Apple notes sync: ${state.message}`;
				break;
			case "idle":
				// A blocked file outranks queued changes: the queue drains itself,
				// the block waits for the user. The number beside the icon counts
				// whichever the icon is about; the tooltip has both.
				if (state.blocked.length > 0) {
					setIcon(iconEl, "alert-triangle");
					textEl.setText(String(state.blocked.length));
				} else if (state.pendingCount > 0) {
					setIcon(iconEl, "cloud");
					textEl.setText(String(state.pendingCount));
				} else {
					setIcon(iconEl, "cloud-check");
				}
				el.ariaLabel = `Apple Notes sync: ${describeIdle(state)}`;
				break;
		}
	}
}
