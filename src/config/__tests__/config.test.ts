import { describe, expect, it } from "bun:test"
import { parseJsonc, loadConfig } from "../loader"
import { resolveConfig, dumpResolvedConfig, loadAndResolveAll } from "../resolver"
import {
  AgentSettingsSchema,
  RootConfigSchema,
  DEFAULT_RESOLVED_CONFIG,
  type AgentSettings,
  type ResolvedConfig,
} from "../types"

// ---------------------------------------------------------------------------
// 1. Valid config
// ---------------------------------------------------------------------------
const VALID_JSONC = `{
  // This is a comment
  "agents": {
    "writer": {
      "modelId": "claude-sonnet-4-20250514",
      "temperature": 0.9,
      "maxOutputTokens": 4096,
      "timeoutMs": 120000,
      "reasoningMode": "auto"
    }
  }
}`

describe("loader — parseJsonc", () => {
  // #given a JSONC string with // comments and trailing commas
  // #when parsed
  // #then valid JSON is produced
  it("strips single-line comments", () => {
    const result = parseJsonc(VALID_JSONC) as any
    expect(result.agents.writer.modelId).toBe("claude-sonnet-4-20250514")
  })

  // #given a JSONC string with /* */ block comments
  // #when parsed
  // #then block comments are removed
  it("strips block comments", () => {
    const raw = `{
      /* block comment */
      "key": "value" /* inline */,
      /* another */ "num": 42
    }`
    const result = parseJsonc(raw) as any
    expect(result.key).toBe("value")
    expect(result.num).toBe(42)
  })

  // #given a JSONC string with trailing commas
  // #when parsed
  // #then trailing commas are removed before ] or }
  it("handles trailing commas", () => {
    const raw = `{
      "arr": [1, 2, 3,],
      "obj": {"a": 1,},
    }`
    const result = parseJsonc(raw) as any
    expect(result.arr).toEqual([1, 2, 3])
    expect(result.obj).toEqual({ a: 1 })
  })

  // #given a JSONC string with // inside a string value
  // #when parsed
  // #then the // is preserved as part of the string
  it("preserves // inside string values", () => {
    const raw = `{ "url": "https://example.com/foo?x=1//end" }`
    const result = parseJsonc(raw) as any
    expect(result.url).toBe("https://example.com/foo?x=1//end")
  })

  // #given a JSONC string with /* inside a string value
  // #when parsed
  // #then the /* is preserved as part of the string
  it("preserves /* inside string values", () => {
    const raw = `{ "code": "x = a /* b */ c" }`
    const result = parseJsonc(raw) as any
    expect(result.code).toBe("x = a /* b */ c")
  })

  // #given a JSONC string with escaped quotes inside strings
  // #when parsed
  // #then escaped quotes are handled correctly
  it("handles escaped quotes inside strings", () => {
    const raw = `{ "msg": "he said \\"hello world\\"" }`
    const result = parseJsonc(raw) as any
    expect(result.msg).toBe('he said "hello world"')
  })
})

describe("loader — loadConfig", () => {
  // #given a valid JSONC config
  // #when loaded and validated
  // #then a RootConfig is returned
  it("loads a valid JSONC config", () => {
    const config = loadConfig(VALID_JSONC)
    expect(config.agents?.writer?.modelId).toBe("claude-sonnet-4-20250514")
    expect(config.agents?.writer?.temperature).toBe(0.9)
  })

  // #given a JSONC config with no agents block
  // #when loaded
  // #then an empty config is returned
  it("accepts an empty config", () => {
    const config = loadConfig(`{}`)
    expect(config.agents).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 2. Invalid config — unknown keys rejected
// ---------------------------------------------------------------------------
describe("schema validation — unknown keys", () => {
  // #given a config with an unknown top-level key
  // #when validated
  // #then it is rejected
  it("rejects unknown top-level keys", () => {
    const raw = `{ "unknownKey": true, "agents": {} }`
    expect(() => RootConfigSchema.parse(JSON.parse(raw))).toThrow()
  })

  // #given a config with an unknown key inside an agent settings block
  // #when validated
  // #then it is rejected
  it("rejects unknown keys inside agent settings", () => {
    const raw = `{ "agents": { "writer": { "unknownField": 1 } } }`
    expect(() => RootConfigSchema.parse(JSON.parse(raw))).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3. Invalid config — invalid values
// ---------------------------------------------------------------------------
describe("schema validation — invalid values", () => {
  // #given a config with temperature out of range
  // #when validated
  // #then it is rejected
  it("rejects temperature < 0", () => {
    expect(() => AgentSettingsSchema.parse({ temperature: -1 })).toThrow()
  })

  // #given a config with temperature > 2
  // #when validated
  // #then it is rejected
  it("rejects temperature > 2", () => {
    expect(() => AgentSettingsSchema.parse({ temperature: 3 })).toThrow()
  })

  // #given a config with non-integer maxOutputTokens
  // #when validated
  // #then it is rejected
  it("rejects non-integer maxOutputTokens", () => {
    expect(() => AgentSettingsSchema.parse({ maxOutputTokens: 1.5 })).toThrow()
  })

  // #given a config with negative timeoutMs
  // #when validated
  // #then it is rejected
  it("rejects negative timeoutMs", () => {
    expect(() => AgentSettingsSchema.parse({ timeoutMs: -100 })).toThrow()
  })

  // #given a config with invalid reasoningMode
  // #when validated
  // #then it is rejected
  it("rejects invalid reasoningMode", () => {
    expect(() => AgentSettingsSchema.parse({ reasoningMode: "turbo" })).toThrow()
  })

  // #given a config with empty modelId
  // #when validated
  // #then it is rejected
  it("rejects empty modelId", () => {
    expect(() => AgentSettingsSchema.parse({ modelId: "" })).toThrow()
  })

  // #given loadConfig with an invalid value
  // #when called
  // #then it throws
  it("loadConfig throws on invalid agent value", () => {
    const raw = `{ "agents": { "writer": { "temperature": 99 } } }`
    expect(() => loadConfig(raw)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 4. Precedence override
// ---------------------------------------------------------------------------
describe("resolver — precedence", () => {
  const repoConfig: Record<string, AgentSettings> = {
    "writer": {
      modelId: "from-repo",
      temperature: 0.5,
    },
  }

  // #given repo config with modelId and temperature
  // #when resolved without override
  // #then repo values override defaults
  it("repo config overrides defaults", () => {
    const result = resolveConfig("writer", repoConfig)
    expect(result.modelId).toBe("from-repo")
    expect(result.temperature).toBe(0.5)
  })

  // #given defaults + repo config + command override
  // #when resolved
  // #then command override wins
  it("command override wins over repo config", () => {
    const override: Partial<AgentSettings> = { temperature: 0.1 }
    const result = resolveConfig("writer", repoConfig, override)
    expect(result.modelId).toBe("from-repo")
    expect(result.temperature).toBe(0.1)
  })

  // #given an agent not present in repo config
  // #when resolved
  // #then defaults are used
  it("defaults for unconfigured agents", () => {
    const result = resolveConfig("non-existent-agent", repoConfig)
    expect(result).toEqual(DEFAULT_RESOLVED_CONFIG)
  })

  // #given command override with only one field
  // #when resolved
  // #then other fields still come from repo/defaults
  it("partial override merges correctly", () => {
    const override: Partial<AgentSettings> = { timeoutMs: 999 }
    const result = resolveConfig("writer", repoConfig, override)
    expect(result.modelId).toBe("from-repo")
    expect(result.temperature).toBe(0.5)
    expect(result.timeoutMs).toBe(999)
    expect(result.maxOutputTokens).toBe(DEFAULT_RESOLVED_CONFIG.maxOutputTokens)
    expect(result.reasoningMode).toBe(DEFAULT_RESOLVED_CONFIG.reasoningMode)
  })

  // #given no repo config or override
  // #when resolved
  // #then defaults are returned
  it("returns defaults when no config provided", () => {
    const result = resolveConfig("writer")
    expect(result).toEqual(DEFAULT_RESOLVED_CONFIG)
  })

  // #given null repo config
  // #when resolved
  // #then defaults are returned
  it("handles null repo config gracefully", () => {
    const result = resolveConfig("writer", null, null)
    expect(result).toEqual(DEFAULT_RESOLVED_CONFIG)
  })
})

// ---------------------------------------------------------------------------
// 5. dumpResolvedConfig
// ---------------------------------------------------------------------------
describe("resolver — dumpResolvedConfig", () => {
  // #given a repo config with one agent override
  // #when dumped
  // #then every known agent has a resolved config
  it("returns all known agents", () => {
    const repoConfig: Record<string, AgentSettings> = {
      "writer": { modelId: "custom-model" },
    }
    const all = dumpResolvedConfig(repoConfig)
    const names = Object.keys(all)

    expect(names).toContain("creative-director")
    expect(names).toContain("writer")
    expect(names).toContain("continuity-checker")
    expect(names).toHaveLength(10)

    expect(all.writer.modelId).toBe("custom-model")
    expect(all["creative-director"].modelId).toBe(DEFAULT_RESOLVED_CONFIG.modelId)
  })

  // #given command overrides for some agents
  // #when dumped
  // #then overrides are applied
  it("applies command overrides per agent", () => {
    const overrides: Record<string, Partial<AgentSettings>> = {
      "writer": { temperature: 0.99 },
    }
    const all = dumpResolvedConfig({}, overrides)
    expect(all.writer.temperature).toBe(0.99)
    expect(all["creative-director"].temperature).toBe(DEFAULT_RESOLVED_CONFIG.temperature)
  })
})

// ---------------------------------------------------------------------------
// 6. loadAndResolveAll integration
// ---------------------------------------------------------------------------
describe("resolver — loadAndResolveAll", () => {
  // #given a JSONC config string
  // #when loaded and resolved
  // #then all agents have resolved configs
  it("loads JSONC and resolves all agents", () => {
    const all = loadAndResolveAll(VALID_JSONC)
    expect(all.writer.modelId).toBe("claude-sonnet-4-20250514")
    expect(all.writer.temperature).toBe(0.9)
    expect(all["creative-director"]).toEqual(DEFAULT_RESOLVED_CONFIG)
  })

  // #given an invalid JSONC string
  // #when loaded and resolved
  // #then it throws
  it("throws on invalid JSONC", () => {
    expect(() => loadAndResolveAll(`{ invalid json }`)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 7. ResolvedConfig type shape
// ---------------------------------------------------------------------------
describe("resolved config shape", () => {
  // #given a resolved config
  // #when inspected
  // #then all five expected fields are present
  it("contains all required fields", () => {
    const resolved: ResolvedConfig = resolveConfig("writer")
    expect(resolved).toHaveProperty("modelId")
    expect(resolved).toHaveProperty("temperature")
    expect(resolved).toHaveProperty("maxOutputTokens")
    expect(resolved).toHaveProperty("timeoutMs")
    expect(resolved).toHaveProperty("reasoningMode")
  })
})
