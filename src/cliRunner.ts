import { spawn as nodeSpawn } from "node:child_process";
import { Platform } from "obsidian";
import { buildEnv, directoryOf, normalizeBinaryPath, planSpawn, type ProcessEnv } from "./cliEnv";
import type IcloudPlugin from "./main";

/**
 * Obsidian's plugin review type-checks without @types/node, which collapses
 * every node:child_process / process value to `any` and trips the no-unsafe-*
 * rules. Pin the slice of the node API we use to explicit local types so the
 * boundary stays typed whether or not the ambient node types are present.
 */
interface SpawnedStream {
	on(event: "data", listener: (data: { toString(): string }) => void): void;
}

interface SpawnedChild {
	stdout: SpawnedStream;
	stderr: SpawnedStream;
	on(event: "error", listener: (err: Error) => void): void;
	on(event: "close", listener: (code: number | null) => void): void;
}

const spawn = nodeSpawn as unknown as (
	command: string,
	args: string[],
	options: { cwd?: string; env: ProcessEnv; windowsVerbatimArguments?: boolean },
) => SpawnedChild;

const processEnv = (window as unknown as { process: { env: ProcessEnv } }).process.env;

export interface CliRunResult {
	stdout: string;
	stderr: string;
	code: number | null;
	error: Error | undefined;
}

export interface CliRunOptions {
	cwd?: string;
	onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

/** The user's explicit override, falling back to bare `icloud-md` on PATH. */
function resolveBinary(plugin: IcloudPlugin): string {
	return normalizeBinaryPath(plugin.localStorage.getBinaryPath() ?? "") || "icloud-md";
}

/** Spawns the icloud-md CLI and resolves once it exits, streaming output as it arrives. */
export function runIcloudMd(plugin: IcloudPlugin, args: string[], options: CliRunOptions = {}): Promise<CliRunResult> {
	if (!Platform.isDesktopApp) {
		return Promise.resolve({
			stdout: "",
			stderr: "",
			code: null,
			error: new Error("icloud-md can only be run on desktop"),
		});
	}

	return new Promise((resolve) => {
		const binary = resolveBinary(plugin);
		const env = buildEnv(processEnv, plugin.localStorage.getPathAdditions(), directoryOf(binary), Platform.isWin);
		const plan = planSpawn(binary, args, Platform.isWin, env);
		const child = spawn(plan.command, plan.args, {
			cwd: options.cwd,
			env,
			windowsVerbatimArguments: plan.windowsVerbatimArguments,
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data) => {
			const chunk = data.toString();
			stdout += chunk;
			options.onOutput?.(chunk, "stdout");
		});
		child.stderr.on("data", (data) => {
			const chunk = data.toString();
			stderr += chunk;
			options.onOutput?.(chunk, "stderr");
		});

		child.on("error", (err) => {
			resolve({ stdout, stderr, code: null, error: err });
		});
		child.on("close", (code) => {
			resolve({ stdout, stderr, code, error: undefined });
		});
	});
}
