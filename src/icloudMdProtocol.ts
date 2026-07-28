/** Pure parsing for icloud-md's `--json` stdout/stderr contract - kept free of any Obsidian
 * import so it can be unit-tested directly under plain Node. */

const PROGRESS_PREFIX = "icloud-md:progress:";

export type IcloudMdProgress =
	| { type: "fetch"; recordsSoFar: number }
	| { type: "process-start"; total: number }
	| { type: "process"; processed: number; total: number }
	| { type: "process-done" };

export interface IcloudMdErrorPayload {
	error: string;
	message: string;
	hint?: string;
	exitCode: number;
}

export function parseProgressLine(line: string): IcloudMdProgress | undefined {
	if (!line.startsWith(PROGRESS_PREFIX)) {
		return undefined;
	}
	const body = line.slice(PROGRESS_PREFIX.length);
	const [kind, rest] = body.split(":", 2);
	switch (kind) {
		case "fetch":
			return { type: "fetch", recordsSoFar: Number(rest) };
		case "process-start":
			return { type: "process-start", total: Number(rest) };
		case "process": {
			const [processed, total] = rest.split("/");
			return { type: "process", processed: Number(processed), total: Number(total) };
		}
		case "process-done":
			return { type: "process-done" };
		default:
			return undefined;
	}
}

/**
 * icloud-md pretty-prints one JSON payload as the last thing on the stream,
 * so the object starts at column 0 on its own line: locate that last `\n{`
 * and parse from there, tolerating anything printed before it.
 *
 * Tolerance matters because `--json` mode's stdout-is-pure-JSON contract can
 * be broken by tools icloud-md itself shells out to - Playwright's first-run
 * "Downloading Chromium..." progress being the observed case.
 */
function parseTrailingJson(text: string): unknown {
	// A clean stream parses whole, which keeps any shape of payload working -
	// the scan below only recognises a trailing *object*.
	const whole = text.trim();
	if (whole.length > 0) {
		try {
			return JSON.parse(whole);
		} catch {
			// Not pure JSON; fall through to locating the trailing payload.
		}
	}

	const start = text.lastIndexOf("\n{");
	const jsonText = start === -1 ? (text.trimStart().startsWith("{") ? text : undefined) : text.slice(start + 1);
	if (!jsonText) {
		return undefined;
	}
	try {
		return JSON.parse(jsonText);
	} catch {
		return undefined;
	}
}

/** The successful command result from stdout, or undefined if stdout held no parseable payload. Wrapped so a payload that is itself falsy stays distinguishable from "nothing found". */
export function parseResultPayload<T>(stdout: string): { value: T } | undefined {
	const parsed = parseTrailingJson(stdout);
	return parsed === undefined ? undefined : { value: parsed as T };
}

/** The final catch in icloud-md's `main()` writes one pretty-printed JSON payload as the last thing on stderr; find it amid any progress/status lines that preceded it. */
export function parseErrorPayload(stderr: string): IcloudMdErrorPayload | undefined {
	// Anything else (e.g. a spawn() failure, or plain text) isn't a
	// structured error payload.
	const parsed = parseTrailingJson(stderr);
	if (typeof parsed === "object" && parsed !== null && "error" in parsed && "message" in parsed && "exitCode" in parsed) {
		return parsed as IcloudMdErrorPayload;
	}
	return undefined;
}
