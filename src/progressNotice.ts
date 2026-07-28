import { Notice } from "obsidian";
import type { IcloudMdCallOptions } from "./icloudMdClient";
import { describeProgress, isDisplayableStatusLine, STARTING_STATUS } from "./progressMessages";

/** Obsidian keeps a notice on screen until it is dismissed when its duration is 0. */
const UNTIL_DISMISSED = 0;

/**
 * A notice that stays up for the whole of a long-running icloud-md run, so a sign-in that takes
 * minutes doesn't look like a hung button. Its last line follows whatever icloud-md reports on
 * stderr; the caller is responsible for calling `hide()` when the run finishes, however it ends.
 */
export class ProgressNotice {
	private readonly notice: Notice;
	private status: string = STARTING_STATUS;

	constructor(
		private readonly headline: string,
		private readonly detail: string,
	) {
		this.notice = new Notice(this.render(), UNTIL_DISMISSED);
	}

	setStatus(status: string): void {
		this.status = status;
		this.notice.setMessage(this.render());
	}

	hide(): void {
		this.notice.hide();
	}

	/** Call options that route icloud-md's own progress/status lines into this notice. */
	get callOptions(): IcloudMdCallOptions {
		return {
			onProgress: (event) => this.setStatus(describeProgress(event)),
			onStatusLine: (line) => {
				if (isDisplayableStatusLine(line)) {
					this.setStatus(line.trim());
				}
			},
		};
	}

	private render(): DocumentFragment {
		return createFragment((fragment) => {
			fragment.createDiv({ text: this.headline, cls: "icloud-notice-headline" });
			fragment.createDiv({ text: this.detail });
			fragment.createDiv({ text: this.status, cls: "icloud-notice-status" });
		});
	}
}
