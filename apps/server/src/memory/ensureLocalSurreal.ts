import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

export const DEFAULT_LOCAL_URL = "ws://127.0.0.1:8000";
export const DEFAULT_LOCAL_USER = "root";
export const DEFAULT_LOCAL_PASS = "root";
export const DEFAULT_BIND = "127.0.0.1:8000";

const HEALTH_TIMEOUT_MS = 800;
const START_WAIT_MS = 10_000;
const START_POLL_MS = 200;

export type EnsureLocalSurrealStatus = "already-running" | "started" | "skipped";

export interface SpawnedProcess {
  readonly pid?: number;
  unref(): void;
}

export interface EnsureLocalSurrealDeps {
  readonly fetch?: typeof fetch;
  readonly spawn?: (command: string, args: ReadonlyArray<string>) => SpawnedProcess;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly mkdir?: (dir: string) => Promise<void>;
  readonly commandPath?: string;
}

export class LocalSurrealUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalSurrealUnavailableError";
  }
}

export function defaultMemoryDataDir(): string {
  return NodePath.join(NodeOs.homedir(), ".t3", "memory", "db");
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

export function bindAddressFor(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!isLoopbackUrl(url)) {
      return undefined;
    }
    const port = parsed.port === "" ? "8000" : parsed.port;
    const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
    return `${host}:${port}`;
  } catch {
    return undefined;
  }
}

export function healthUrlFor(url: string): string | undefined {
  const bind = bindAddressFor(url);
  return bind === undefined ? undefined : `http://${bind}/health`;
}

export function storageUrlFor(dataDir: string): string {
  return `surrealkv://${dataDir.replaceAll("\\", "/")}`;
}

export function surrealStartArgs(input: {
  readonly bind: string;
  readonly username: string;
  readonly password: string;
  readonly namespace: string;
  readonly database: string;
  readonly dataDir: string;
}): ReadonlyArray<string> {
  return [
    "start",
    "--user",
    input.username,
    "--pass",
    input.password,
    "--bind",
    input.bind,
    "--default-namespace",
    input.namespace,
    "--default-database",
    input.database,
    "--log",
    "info",
    storageUrlFor(input.dataDir),
  ];
}

export async function probeHealth(
  healthUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(healthUrl, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function resolveSurrealExecutable(
  commandPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (commandPath !== undefined && commandPath.length > 0 && commandPath !== "surreal") {
    return commandPath;
  }
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData !== undefined) {
    const installed = NodePath.join(localAppData, "SurrealDB", "surreal.exe");
    if (NodeFs.existsSync(installed)) {
      return installed;
    }
  }
  if (commandPath === "surreal") {
    return "surreal";
  }
  return commandPath;
}

const defaultSpawn = (command: string, args: ReadonlyArray<string>): SpawnedProcess => {
  const child = NodeChildProcess.spawn(command, [...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child;
};

export async function ensureLocalSurreal(
  input: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly namespace: string;
    readonly database: string;
    readonly dataDir: string;
  },
  deps: EnsureLocalSurrealDeps = {},
): Promise<EnsureLocalSurrealStatus> {
  const healthUrl = healthUrlFor(input.url);
  const bind = bindAddressFor(input.url);
  if (healthUrl === undefined || bind === undefined) {
    return "skipped";
  }
  const fetchImpl = deps.fetch ?? fetch;
  if (await probeHealth(healthUrl, fetchImpl)) {
    return "already-running";
  }
  const command = resolveSurrealExecutable(deps.commandPath);
  if (command === undefined || command.length === 0) {
    throw new LocalSurrealUnavailableError("The surreal CLI was not found on PATH.");
  }
  await (
    deps.mkdir ??
    (async (dir: string) => {
      await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
    })
  )(input.dataDir);
  const spawn = deps.spawn ?? defaultSpawn;
  spawn(
    command,
    surrealStartArgs({
      bind,
      username: input.username,
      password: input.password,
      namespace: input.namespace,
      database: input.database,
      dataDir: input.dataDir,
    }),
  );
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = now() + START_WAIT_MS;
  while (now() < deadline) {
    if (await probeHealth(healthUrl, fetchImpl)) {
      return "started";
    }
    await sleep(START_POLL_MS);
  }
  throw new LocalSurrealUnavailableError(`SurrealDB did not become healthy at ${healthUrl}.`);
}
