import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildEnv,
	directoryOf,
	joinPathEntries,
	lookupEnv,
	normalizeBinaryPath,
	planSpawn,
	quoteForCmd,
	splitPathEntries,
} from "./cliEnv";

const WIN = true;
const POSIX = false;

void test("splitPathEntries keeps Windows drive letters intact", () => {
	assert.deepEqual(splitPathEntries(String.raw`C:\Users\me\AppData\Roaming\npm`, WIN), [
		String.raw`C:\Users\me\AppData\Roaming\npm`,
	]);
	assert.deepEqual(splitPathEntries(String.raw`C:\npm;D:\tools\bin`, WIN), [String.raw`C:\npm`, String.raw`D:\tools\bin`]);
});

void test("splitPathEntries splits on colons off Windows", () => {
	assert.deepEqual(splitPathEntries("/usr/local/bin:/opt/homebrew/bin", POSIX), ["/usr/local/bin", "/opt/homebrew/bin"]);
});

void test("splitPathEntries drops empty and whitespace-only entries", () => {
	assert.deepEqual(splitPathEntries("/usr/local/bin::  : /opt/bin ", POSIX), ["/usr/local/bin", "/opt/bin"]);
	assert.deepEqual(splitPathEntries("", POSIX), []);
});

void test("joinPathEntries round-trips through splitPathEntries on both platforms", () => {
	const winEntries = [String.raw`C:\npm`, String.raw`D:\tools\bin`];
	assert.deepEqual(splitPathEntries(joinPathEntries(winEntries, WIN), WIN), winEntries);

	const posixEntries = ["/usr/local/bin", "/opt/homebrew/bin"];
	assert.deepEqual(splitPathEntries(joinPathEntries(posixEntries, POSIX), POSIX), posixEntries);
});

void test("directoryOf returns the containing directory for either separator", () => {
	assert.equal(directoryOf("/Users/me/.nvm/versions/node/v24.14.1/bin/icloud-md"), "/Users/me/.nvm/versions/node/v24.14.1/bin");
	assert.equal(directoryOf(String.raw`C:\Users\me\AppData\Roaming\npm\icloud-md.cmd`), String.raw`C:\Users\me\AppData\Roaming\npm`);
});

void test("directoryOf keeps root paths rooted", () => {
	assert.equal(directoryOf("/icloud-md"), "/");
	// "C:" alone is the drive-relative directory, which is not the drive root.
	// (Written with escapes rather than String.raw: a template literal can't
	// end in a backslash, which would escape its own closing backtick.)
	assert.equal(directoryOf("C:\\icloud-md"), "C:\\");
});

void test("directoryOf returns nothing for a bare command name", () => {
	assert.equal(directoryOf("icloud-md"), "");
	assert.equal(directoryOf("icloud-md.cmd"), "");
});

void test("normalizeBinaryPath strips whitespace and Explorer's Copy-as-path quotes", () => {
	const quoted = String.raw`  "C:\Program Files\npm\icloud-md.cmd"  `;
	assert.equal(normalizeBinaryPath(quoted), String.raw`C:\Program Files\npm\icloud-md.cmd`);
	assert.equal(normalizeBinaryPath(" /usr/local/bin/icloud-md "), "/usr/local/bin/icloud-md");
	assert.equal(normalizeBinaryPath(""), "");
	// A lone quote isn't a wrapping pair and must survive untouched.
	assert.equal(normalizeBinaryPath('"'), '"');
});

void test("buildEnv prepends additions and the binary's own directory to PATH", () => {
	const env = buildEnv({ PATH: "/usr/bin:/bin" }, ["/opt/homebrew/bin"], "/Users/me/.nvm/versions/node/v24.14.1/bin", POSIX);
	assert.equal(env["PATH"], "/opt/homebrew/bin:/Users/me/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin");
});

void test("buildEnv updates Windows' existing `Path` key rather than adding a second one", () => {
	const env = buildEnv({ Path: String.raw`C:\Windows\system32` }, [String.raw`C:\npm`], "", WIN);

	assert.equal(env["Path"], String.raw`C:\npm;C:\Windows\system32`);
	assert.deepEqual(Object.keys(env), ["Path"], "must not create a conflicting PATH alongside Path");
});

void test("buildEnv joins Windows entries with semicolons", () => {
	const env = buildEnv({ Path: String.raw`C:\Windows\system32` }, [String.raw`C:\npm`], String.raw`D:\tools\bin`, WIN);
	assert.equal(env["Path"], String.raw`C:\npm;D:\tools\bin;C:\Windows\system32`);
});

void test("buildEnv creates PATH when the base environment has none", () => {
	assert.equal(buildEnv({}, ["/opt/bin"], "", POSIX)["PATH"], "/opt/bin");
	assert.equal(buildEnv({ PATH: "" }, ["/opt/bin"], "", POSIX)["PATH"], "/opt/bin");
});

void test("buildEnv leaves PATH untouched when there is nothing to prepend", () => {
	const env = buildEnv({ PATH: "/usr/bin", HOME: "/Users/me" }, [], "", POSIX);
	assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/Users/me" });
});

void test("buildEnv does not repeat the binary directory already listed by the user", () => {
	const env = buildEnv({ PATH: "/usr/bin" }, ["/opt/bin"], "/opt/bin", POSIX);
	assert.equal(env["PATH"], "/opt/bin:/usr/bin");
});

void test("buildEnv writes the exact PATH name off Windows, where casing is significant", () => {
	// A POSIX environment carrying an unrelated `Path` must not be mistaken
	// for PATH; only Windows treats the two names as the same variable.
	const env = buildEnv({ Path: "/something/else", PATH: "/usr/bin" }, ["/opt/bin"], "", POSIX);

	assert.equal(env["PATH"], "/opt/bin:/usr/bin");
	assert.equal(env["Path"], "/something/else");
});

void test("buildEnv copies rather than mutates the environment it is given", () => {
	const base = { PATH: "/usr/bin" };
	buildEnv(base, ["/opt/bin"], "", POSIX);
	assert.equal(base.PATH, "/usr/bin");
});

void test("lookupEnv reads a variable regardless of the stored key's casing", () => {
	assert.equal(lookupEnv({ ComSpec: String.raw`C:\Windows\system32\cmd.exe` }, "COMSPEC"), String.raw`C:\Windows\system32\cmd.exe`);
	assert.equal(lookupEnv({}, "COMSPEC"), undefined);
});

void test("planSpawn passes the command straight through off Windows", () => {
	const plan = planSpawn("icloud-md", ["--json", "pull", "/Users/me/vault/notes"], POSIX, {});
	assert.deepEqual(plan, {
		command: "icloud-md",
		args: ["--json", "pull", "/Users/me/vault/notes"],
		windowsVerbatimArguments: false,
	});
});

void test("planSpawn routes through cmd.exe on Windows so the .cmd shim resolves", () => {
	const plan = planSpawn("icloud-md", ["--json", "status"], WIN, { ComSpec: String.raw`C:\Windows\system32\cmd.exe` });

	assert.equal(plan.command, String.raw`C:\Windows\system32\cmd.exe`);
	assert.deepEqual(plan.args, ["/d", "/s", "/c", '""icloud-md" "--json" "status""']);
	assert.equal(plan.windowsVerbatimArguments, true, "the hand-built command line must not be re-escaped by Node");
});

void test("planSpawn falls back to cmd.exe when ComSpec is unset", () => {
	assert.equal(planSpawn("icloud-md", [], WIN, {}).command, "cmd.exe");
});

void test("planSpawn quotes vault paths containing spaces and cmd metacharacters", () => {
	const binary = String.raw`C:\Program Files\npm\icloud-md.cmd`;
	const vault = String.raw`C:\Users\Bob & Alice\Obsidian (main)\notes`;
	const plan = planSpawn(binary, ["--json", "pull", vault], WIN, {});

	assert.equal(plan.args[3], '""' + binary + '" "--json" "pull" "' + vault + '""');
});

void test("quoteForCmd wraps a token and doubles any embedded quote", () => {
	assert.equal(quoteForCmd("plain"), '"plain"');
	assert.equal(quoteForCmd('a"b'), '"a""b"');
});
