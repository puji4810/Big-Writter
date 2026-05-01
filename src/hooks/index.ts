import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { createContextInjectorHook } from "./context-injector"

export { buildCompactContextSummary, createContextInjectorHook, formatCompactContext, type CompactContextSummary, type EvidenceSummaryItem } from "./context-injector"

export function registerAllHooks(ctx: PluginInput): Partial<Awaited<ReturnType<Plugin>>> {
  return createContextInjectorHook(ctx) as Partial<Awaited<ReturnType<Plugin>>>
}
