import { computeArtifactHash } from "../schemas/review"
import { DEFAULT_MAX_CHUNK_BYTES, type TextChunk } from "./types"

const encoder = new TextEncoder()

export function splitTextIntoChunks(text: string, maxBytes = DEFAULT_MAX_CHUNK_BYTES): TextChunk[] {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`maxBytes must be a positive integer; received ${maxBytes}`)
  }

  if (text.length === 0) {
    return [{
      order: 1,
      content: "",
      contentHash: computeArtifactHash(""),
      byteSize: 0,
    }]
  }

  const chunks: TextChunk[] = []
  let start = 0
  let order = 1

  while (start < text.length) {
    const hardEnd = findMaxEndWithinBytes(text, start, maxBytes)
    if (hardEnd <= start) {
      throw new Error(`Unable to split text at position ${start} within ${maxBytes} bytes`)
    }

    let end = hardEnd
    if (hardEnd < text.length) {
      const candidate = text.slice(start, hardEnd)
      const paragraphBoundary = candidate.lastIndexOf("\n\n")
      const lineBoundary = candidate.lastIndexOf("\n")
      if (paragraphBoundary > 0) {
        end = start + paragraphBoundary + 2
      } else if (lineBoundary > 0) {
        end = start + lineBoundary + 1
      }
    }

    const content = text.slice(start, end)
    chunks.push({
      order,
      content,
      contentHash: computeArtifactHash(content),
      byteSize: byteLength(content),
    })

    start = end
    order += 1
  }

  return chunks
}

function findMaxEndWithinBytes(text: string, start: number, maxBytes: number): number {
  let used = 0
  let end = start

  for (let index = start; index < text.length;) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) break

    const char = String.fromCodePoint(codePoint)
    const charBytes = byteLength(char)
    if (used + charBytes > maxBytes) {
      break
    }

    used += charBytes
    index += char.length
    end = index
  }

  return end
}

function byteLength(value: string): number {
  return encoder.encode(value).length
}
