import { RootConfigSchema, type RootConfig } from "./types"

// Strip JSONC comments (single-line // and block /* */) and trailing commas,
// then parse as JSON. Handles string contents correctly so that // or
// /* inside a JSON string value are not treated as comment delimiters.
export function parseJsonc(raw: string): unknown {
  const chars: string[] = []
  let i = 0
  const len = raw.length

  while (i < len) {
    const c = raw[i]

    // --- inside a string literal ---
    if (c === '"') {
      chars.push(c)
      i++
      while (i < len) {
        const sc = raw[i]
        chars.push(sc)
        if (sc === "\\") {
          // escaped char — consume next unconditionally
          i++
          if (i < len) {
            chars.push(raw[i])
            i++
          }
          continue
        }
        if (sc === '"') {
          i++
          break
        }
        i++
      }
      continue
    }

    // --- single-line comment // ---
    if (c === "/" && i + 1 < len && raw[i + 1] === "/") {
      i += 2
      while (i < len && raw[i] !== "\n") {
        i++
      }
      continue
    }

    // --- multi-line comment /* */ ---
    if (c === "/" && i + 1 < len && raw[i + 1] === "*") {
      i += 2
      while (i < len) {
        if (raw[i] === "*" && i + 1 < len && raw[i + 1] === "/") {
          i += 2
          break
        }
        i++
      }
      continue
    }

    chars.push(c)
    i++
  }

  let cleaned = chars.join("")

  // Strip trailing commas before ] or }
  cleaned = cleaned.replaceAll(/,(\s*[}\]])/g, "$1")

  return JSON.parse(cleaned)
}

/**
 * Parse a JSONC string and validate it against RootConfigSchema.
 * Returns the validated config or throws a ZodError on validation failure.
 */
export function loadConfig(raw: string): RootConfig {
  const parsed = parseJsonc(raw)
  return RootConfigSchema.parse(parsed)
}
