/** Wording and filtering for the long-running "signing in / first sync" notice - kept free
 * of any Obsidian import so it can be unit-tested directly under plain Node. */

import type { IcloudMdProgress } from "./icloudMdProtocol";

/** Shown for the whole of a sign-in. `clone` opens a browser window through Playwright, which
 * on a first run downloads Chromium before anything visible happens - hence the warning that
 * the window itself can take a while, not just the sync that follows it. */
export const SIGN_IN_PATIENCE =
	"A browser window will open for Apple ID sign-in. It can take a minute to appear, and the " +
	"first sync can take several more - please leave Obsidian open until this notice goes away.";

export const CONNECT_HEADLINE = "Apple Notes: connecting...";
export const REAUTHENTICATE_HEADLINE = "Apple Notes: signing in...";
export const STARTING_STATUS = "Starting icloud-md...";

/** One line of live detail for the notice, so a long run visibly makes progress. */
export function describeProgress(event: IcloudMdProgress): string {
	switch (event.type) {
		case "fetch":
			return `Fetching notes from iCloud (${event.recordsSoFar} so far)...`;
		case "process-start":
			return `Processing ${event.total} note(s)...`;
		case "process":
			return `Processing note ${event.processed} of ${event.total}...`;
		case "process-done":
			return "Finishing up...";
	}
}

/** icloud-md's stderr carries human status lines, but a failing run ends by pretty-printing its
 * JSON error payload there too. Those lines reach the caller as `result.error` and get their own
 * notice, so keep them out of the status line rather than flashing `"exitCode": 1` at the user. */
export function isDisplayableStatusLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.length > 0 && !/^[{}[\]"]/.test(trimmed);
}
