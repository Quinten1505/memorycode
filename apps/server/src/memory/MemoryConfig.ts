import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export interface MemoryConfigValue {
  readonly url: string | undefined;
  readonly namespace: string;
  readonly database: string;
  readonly username: string | undefined;
  readonly password: string | undefined;
  readonly embedDim: number;
  /** When true (default), T3 starts a loopback Surreal if one is not already healthy. */
  readonly autostart: boolean;
  readonly dataDir: string | undefined;
}

const DEFAULT_NAMESPACE = "harness";
const DEFAULT_DATABASE = "memory";
const DEFAULT_EMBED_DIM = 1536;

const present = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const parseEmbedDim = (value: string | undefined): number => {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_EMBED_DIM;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_EMBED_DIM;
};

const parseAutostart = (value: string | undefined): boolean => {
  const normalized = present(value)?.toLowerCase();
  if (normalized === undefined) {
    return true;
  }
  return (
    normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off"
  );
};

export function decodeMemoryConfig(
  env: Readonly<Record<string, string | undefined>>,
): MemoryConfigValue {
  return {
    url: present(env.SURREAL_URL),
    namespace: present(env.SURREAL_NS) ?? DEFAULT_NAMESPACE,
    database: present(env.SURREAL_DB) ?? DEFAULT_DATABASE,
    username: present(env.SURREAL_USER),
    password: present(env.SURREAL_PASS),
    embedDim: parseEmbedDim(env.EMBED_DIM),
    autostart: parseAutostart(env.SURREAL_AUTOSTART),
    dataDir: present(env.SURREAL_DATA_DIR),
  };
}

const optionalText = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Config.map((option) => present(Option.getOrUndefined(option))),
  );

const MemoryEnvConfig = Config.all({
  url: optionalText("SURREAL_URL"),
  namespace: Config.string("SURREAL_NS").pipe(
    Config.withDefault(DEFAULT_NAMESPACE),
    Config.map((value) => present(value) ?? DEFAULT_NAMESPACE),
  ),
  database: Config.string("SURREAL_DB").pipe(
    Config.withDefault(DEFAULT_DATABASE),
    Config.map((value) => present(value) ?? DEFAULT_DATABASE),
  ),
  username: optionalText("SURREAL_USER"),
  password: optionalText("SURREAL_PASS"),
  embedDim: Config.string("EMBED_DIM").pipe(
    Config.option,
    Config.map((option) => parseEmbedDim(Option.getOrUndefined(option))),
  ),
  autostart: Config.string("SURREAL_AUTOSTART").pipe(
    Config.option,
    Config.map((option) => parseAutostart(Option.getOrUndefined(option))),
  ),
  dataDir: optionalText("SURREAL_DATA_DIR"),
});

export class MemoryConfig extends Context.Service<MemoryConfig, MemoryConfigValue>()(
  "t3/memory/MemoryConfig",
) {
  static readonly layer = Layer.effect(
    MemoryConfig,
    Effect.gen(function* () {
      return MemoryConfig.of(yield* MemoryEnvConfig);
    }),
  );
}
