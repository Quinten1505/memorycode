import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { isLoopbackUrl } from "./ensureLocalSurreal.ts";

export { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL } from "./MemoryConfig.ts";

const HEALTH_TIMEOUT_MS = 800;
const START_WAIT_MS = 10_000;
const START_POLL_MS = 200;
const MODEL_WAIT_MS = 3_000;
const WARM_TIMEOUT_MS = 90_000;

export type EnsureLocalOllamaStatus = "already-running" | "started" | "skipped" | "model-missing";

export interface SpawnedProcess {
  readonly pid?: number;
  unref(): void;
}

export interface EnsureLocalOllamaDeps {
  readonly fetch?: typeof fetch;
  readonly spawn?: (
    command: string,
    args: ReadonlyArray<string>,
    env?: NodeJS.ProcessEnv,
  ) => SpawnedProcess;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly commandPath?: string;
}

export class LocalOllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalOllamaUnavailableError";
  }
}

export function ollamaTagsUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!isLoopbackUrl(url)) {
      return undefined;
    }
    const port = parsed.port === "" ? "11434" : parsed.port;
    const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
    return `http://${host}:${port}/api/tags`;
  } catch {
    return undefined;
  }
}

export function ollamaBindHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!isLoopbackUrl(url)) {
      return undefined;
    }
    const port = parsed.port === "" ? "11434" : parsed.port;
    const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
    return `${host}:${port}`;
  } catch {
    return undefined;
  }
}

export function modelIsListed(models: unknown, model: string): boolean {
  if (!Array.isArray(models)) {
    return false;
  }
  return models.some((entry) => {
    if (entry === null || typeof entry !== "object") {
      return false;
    }
    const name = (entry as { name?: unknown; model?: unknown }).name;
    const listed = (entry as { name?: unknown; model?: unknown }).model;
    const candidates = [name, listed].filter((value): value is string => typeof value === "string");
    return candidates.some(
      (value) => value === model || value.startsWith(`${model}:`) || model.startsWith(`${value}:`),
    );
  });
}

export async function probeOllamaTags(
  tagsUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[] | undefined> {
  try {
    const response = await fetchImpl(tagsUrl, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return [];
    }
    const models = (body as { models?: unknown }).models;
    return Array.isArray(models) ? models : [];
  } catch {
    return undefined;
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function resolveOllamaExecutable(
  commandPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (commandPath !== undefined && commandPath.length > 0 && commandPath !== "ollama") {
    return commandPath;
  }
  const localAppData = env.LOCALAPPDATA?.trim();
  if (localAppData !== undefined) {
    const installed = NodePath.join(localAppData, "Programs", "Ollama", "ollama.exe");
    if (NodeFS.existsSync(installed)) {
      return installed;
    }
  }
  const programFiles = env.ProgramFiles?.trim();
  if (programFiles !== undefined) {
    const installed = NodePath.join(programFiles, "Ollama", "ollama.exe");
    if (NodeFS.existsSync(installed)) {
      return installed;
    }
  }
  if (commandPath === "ollama") {
    return "ollama";
  }
  return commandPath ?? "ollama";
}

const defaultSpawn = (
  command: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv,
): SpawnedProcess => {
  const child = NodeChildProcess.spawn(command, [...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: env ?? process.env,
  });
  child.unref();
  return child;
};

async function waitForTags(
  tagsUrl: string,
  fetchImpl: typeof fetch,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
): Promise<unknown[] | undefined> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const models = await probeOllamaTags(tagsUrl, fetchImpl);
    if (models !== undefined) {
      return models;
    }
    await sleep(START_POLL_MS);
  }
  return undefined;
}

export async function warmOllamaModel(
  input: { readonly url: string; readonly model: string; readonly dimensions: number },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL("/api/embed", input.url).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        input: "ok",
        dimensions: input.dimensions,
        keep_alive: -1,
      }),
      signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureLocalOllama(
  input: {
    readonly url: string;
    readonly model: string;
    readonly dimensions: number;
  },
  deps: EnsureLocalOllamaDeps = {},
): Promise<EnsureLocalOllamaStatus> {
  const tagsUrl = ollamaTagsUrl(input.url);
  const bind = ollamaBindHost(input.url);
  if (tagsUrl === undefined || bind === undefined) {
    return "skipped";
  }
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const spawn = deps.spawn ?? defaultSpawn;
  const command = resolveOllamaExecutable(deps.commandPath);

  let started = false;
  let models = await probeOllamaTags(tagsUrl, fetchImpl);
  if (models === undefined) {
    if (command === undefined || command.length === 0) {
      throw new LocalOllamaUnavailableError("The ollama CLI was not found on PATH.");
    }
    spawn(command, ["serve"], {
      ...process.env,
      OLLAMA_HOST: bind,
      OLLAMA_KEEP_ALIVE: "-1",
    });
    started = true;
    models = await waitForTags(tagsUrl, fetchImpl, now, sleep, START_WAIT_MS);
    if (models === undefined) {
      throw new LocalOllamaUnavailableError(`Ollama did not become healthy at ${tagsUrl}.`);
    }
  }

  if (!modelIsListed(models, input.model)) {
    if (command === undefined || command.length === 0) {
      throw new LocalOllamaUnavailableError("The ollama CLI was not found on PATH.");
    }
    spawn(command, ["pull", input.model]);
    const deadline = now() + MODEL_WAIT_MS;
    while (now() < deadline) {
      const next = await probeOllamaTags(tagsUrl, fetchImpl);
      if (next !== undefined && modelIsListed(next, input.model)) {
        models = next;
        break;
      }
      await sleep(START_POLL_MS);
    }
    if (!modelIsListed(models, input.model)) {
      const next = await probeOllamaTags(tagsUrl, fetchImpl);
      if (next === undefined || !modelIsListed(next, input.model)) {
        return "model-missing";
      }
      models = next;
    }
  }

  await warmOllamaModel(
    { url: input.url, model: input.model, dimensions: input.dimensions },
    fetchImpl,
  );
  return started ? "started" : "already-running";
}
