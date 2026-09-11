import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

// The plugin's own package name, used to locate the plugin root (where
// gpt-imagegen.config.json lives) by walking up from this module.
const PLUGIN_PACKAGE_NAME = "opencode-gpt-imagegen"
const CONFIG_FILE_NAME = "gpt-imagegen.config.json"
const MAX_WALK_UP = 5

// Model override read from <plugin root>/gpt-imagegen.config.json, where the
// plugin root is the nearest ancestor directory of this module holding a
// package.json named opencode-gpt-imagegen. The config therefore sits next to
// the plugin itself (repo root for a local checkout), not in every consumer
// project. Shape: { "model": "<codex model slug>" }. Unknown keys are ignored
// so the file can grow more settings later. // and /* */ comments are allowed
// (JSONC-style) so the available model slugs can be documented right in the file.
export async function loadModelOverride(startDir: string = pluginModuleDir()): Promise<string | undefined> {
  const pluginRoot = await findPluginRoot(startDir)
  if (!pluginRoot) return undefined
  const configPath = path.join(pluginRoot, CONFIG_FILE_NAME)
  let raw: string
  try {
    // Strip a leading UTF-8 BOM: Windows editors often write one, and JSON.parse rejects it.
    // Then strip // and /* */ comments (JSONC-style) before parsing.
    raw = stripJsonComments((await fs.readFile(configPath, "utf-8")).replace(/^\uFEFF/, ""))
  } catch (err) {
    // A missing config file is not an error: the default model applies.
    if ((err as { code?: string }).code === "ENOENT") return undefined
    throw err
  }
  return parseModelOverride(configPath, raw)
}

function pluginModuleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url))
}

async function findPluginRoot(startDir: string): Promise<string | undefined> {
  let dir = path.resolve(startDir)
  for (let i = 0; i <= MAX_WALK_UP; i++) {
    if (await isPluginRoot(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

async function isPluginRoot(dir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf-8")) as { name?: unknown }
    return pkg.name === PLUGIN_PACKAGE_NAME
  } catch {
    return false
  }
}

// Strip // line comments and /* */ block comments, ignoring markers inside
// JSON strings. A minimal JSONC reader: enough for commented config files
// without pulling in a JSONC dependency.
function stripJsonComments(raw: string): string {
  let out = ""
  let i = 0
  let inString = false
  while (i < raw.length) {
    const ch = raw[i]
    if (inString) {
      out += ch
      if (ch === "\\") {
        // Keep the escaped char verbatim (e.g. \" must not end the string).
        out += raw[i + 1] ?? ""
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === "/" && raw[i + 1] === "/") {
      // Line comment: skip to (not including) the newline to preserve line structure.
      while (i < raw.length && raw[i] !== "\n") i++
      continue
    }
    if (ch === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2)
      if (end === -1) {
        // Unterminated: leave the rest in place so JSON.parse rejects it as invalid JSON.
        out += raw.slice(i)
        break
      }
      i = end + 2
      continue
    }
    out += ch
    i++
  }
  return out
}

function parseModelOverride(configPath: string, raw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${configPath} is not valid JSON: ${(err as Error).message}`)
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${configPath} must be an object like { "model": "gpt-5.6-sol" }`)
  }
  const model = (parsed as Record<string, unknown>).model
  if (typeof model !== "string" || model.length === 0) {
    throw new Error(`${configPath} requires a non-empty string "model" field`)
  }
  return model
}
