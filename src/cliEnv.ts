/**
 * Platform-dependent PATH and command-line construction for spawning
 * icloud-md. Deliberately imports neither `obsidian` nor `node:*`: the former
 * so these functions are unit-testable outside Obsidian (the obsidian package
 * ships types only, with no runtime module to resolve), the latter for the
 * @types/node-less type-check described in cliRunner.ts. `isWin` is therefore
 * passed in by the caller rather than read from `Platform` here.
 */

export type ProcessEnv = Record<string, string | undefined>;

/** PATH entry separator: ";" on Windows, ":" everywhere else. */
export function pathDelimiter(isWin: boolean): string {
	return isWin ? ";" : ":";
}

/**
 * Parses the user-entered PATH additions setting. Splitting on ":" on Windows
 * would tear `C:\Users\me\AppData\Roaming\npm` into "C" and the rest, so the
 * delimiter has to follow the platform.
 */
export function splitPathEntries(raw: string, isWin: boolean): string[] {
	return raw
		.split(pathDelimiter(isWin))
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

/** Inverse of splitPathEntries, for storing and displaying the setting. */
export function joinPathEntries(entries: readonly string[], isWin: boolean): string {
	return entries.join(pathDelimiter(isWin));
}

/**
 * The directory containing `filePath`, or "" if it names no directory at all
 * (a bare command like `icloud-md`, which is already resolved via PATH).
 * Accepts either separator because Windows users may type either.
 */
export function directoryOf(filePath: string): string {
	const lastSeparator = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
	if (lastSeparator < 0) {
		return "";
	}
	const dir = filePath.slice(0, lastSeparator);
	// "/icloud-md" -> "/", and "C:\icloud-md" -> "C:\" rather than the
	// drive-relative "C:", which means something different.
	if (dir.length === 0 || dir.endsWith(":")) {
		return dir + filePath.charAt(lastSeparator);
	}
	return dir;
}

/**
 * Cleans up a pasted binary path. Windows Explorer's "Copy as path" wraps the
 * path in double quotes, which spawn would treat as part of the file name.
 */
export function normalizeBinaryPath(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/**
 * Looks up an environment variable case-insensitively. Windows env var names
 * are case-insensitive and `process.env` there is a proxy that honours that,
 * but spreading it into a plain object (as buildEnv must, to avoid mutating
 * the host process) loses the proxy and keeps whatever casing the OS used.
 */
function envKeyOf(env: ProcessEnv, name: string): string | undefined {
	const upper = name.toUpperCase();
	return Object.keys(env).find((key) => key.toUpperCase() === upper);
}

export function lookupEnv(env: ProcessEnv, name: string): string | undefined {
	const key = envKeyOf(env, name);
	return key === undefined ? undefined : env[key];
}

/**
 * The environment icloud-md is spawned with: a copy of Obsidian's own, with
 * the user's extra PATH entries and the configured binary's own directory
 * prepended to PATH.
 *
 * GUI-launched Obsidian doesn't inherit the shell PATH, so npm's global bin
 * dir (nvm/Homebrew/asdf) is often invisible to spawn(). Including
 * `binaryDir` matters beyond finding icloud-md itself: it's a `#!/usr/bin/env
 * node` script, so with a version manager the `node` it needs sits in that
 * same directory and is otherwise unfindable too.
 *
 * PATH is updated under its *existing* key, which on Windows is typically
 * `Path`. Writing to a hardcoded "PATH" there would leave the inherited
 * `Path` in place alongside a second, conflicting entry.
 */
export function buildEnv(
	baseEnv: ProcessEnv,
	pathAdditions: readonly string[],
	binaryDir: string,
	isWin: boolean,
): ProcessEnv {
	const env: ProcessEnv = { ...baseEnv };

	const prefixes: string[] = [];
	for (const entry of [...pathAdditions, binaryDir]) {
		if (entry.length > 0 && !prefixes.includes(entry)) {
			prefixes.push(entry);
		}
	}
	if (prefixes.length === 0) {
		return env;
	}

	// Only Windows treats env names case-insensitively. Elsewhere `PATH` and
	// `Path` are genuinely different variables, so searching for one would be
	// wrong: write the exact name, as this always has.
	const key = isWin ? (envKeyOf(env, "PATH") ?? "PATH") : "PATH";
	const existing = env[key];
	env[key] = joinPathEntries(existing ? [...prefixes, existing] : prefixes, isWin);
	return env;
}

/** What to hand to spawn(): the command, its argv, and Windows quoting mode. */
export interface SpawnPlan {
	command: string;
	args: string[];
	windowsVerbatimArguments: boolean;
}

/**
 * Quotes one token for a cmd.exe command line. Double quotes cover spaces and
 * cmd's metacharacters (`&`, `|`, `(`, `)`, `^`), which appear in real vault
 * paths like `C:\Users\Bob & Alice\Obsidian (main)`. A literal `"` can't occur
 * in a Windows path, but is doubled rather than dropped if one shows up.
 *
 * Not covered: a `%VAR%` pair naming a real environment variable still
 * expands, as no cmd-side escape suppresses that inside quotes.
 */
export function quoteForCmd(token: string): string {
	return `"${token.replace(/"/g, '""')}"`;
}

/**
 * Windows can't spawn npm's `icloud-md.cmd` shim directly: libuv's PATH search
 * only tries `.com`/`.exe` (so a bare name gives ENOENT), and naming the
 * `.cmd` explicitly hits Node's post-CVE-2024-27980 guard (EINVAL). Going
 * through cmd.exe sidesteps both, and lets cmd apply PATHEXT - which also
 * resolves an extensionless path like `C:\...\npm\icloud-md` to the shim.
 *
 * `shell: true` would reach the same interpreter but joins argv with spaces
 * *unescaped*, breaking on any path containing a space, so the command line is
 * built here instead. The whole line is wrapped in one extra pair of quotes
 * because `/s` makes cmd strip the outermost pair and take the rest verbatim -
 * the same construction Node's own shell mode uses.
 */
export function planSpawn(binary: string, args: readonly string[], isWin: boolean, env: ProcessEnv): SpawnPlan {
	if (!isWin) {
		return { command: binary, args: [...args], windowsVerbatimArguments: false };
	}

	const commandLine = [binary, ...args].map(quoteForCmd).join(" ");
	return {
		command: lookupEnv(env, "ComSpec") ?? "cmd.exe",
		args: ["/d", "/s", "/c", `"${commandLine}"`],
		windowsVerbatimArguments: true,
	};
}
