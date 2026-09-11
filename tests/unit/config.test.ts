import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { loadModelOverride } from "../../src/config"

describe("loadModelOverride", () => {
  let pluginRoot: string

  beforeEach(async () => {
    // A fake plugin installation: a directory holding a package.json with the
    // plugin's name, mimicking the repo root or the installed package dir.
    pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), "imagegen-plugin-"))
    await fs.writeFile(
      path.join(pluginRoot, "package.json"),
      '{"name":"opencode-gpt-imagegen","version":"0.0.0"}',
    )
  })

  afterEach(async () => {
    await fs.rm(pluginRoot, { recursive: true, force: true })
  })

  async function writeConfig(content: string): Promise<void> {
    await fs.writeFile(path.join(pluginRoot, "gpt-imagegen.config.json"), content)
  }

  test("returns the model from the config next to the plugin root", async () => {
    await writeConfig('{"model":"gpt-5.6-sol"}')
    // Start the search one level below the root, as src/ and dist/ are.
    expect(await loadModelOverride(path.join(pluginRoot, "src"))).toBe("gpt-5.6-sol")
  })

  test("ignores unknown keys next to model", async () => {
    await writeConfig('{"model":"gpt-5.6-sol","future":true}')
    expect(await loadModelOverride(pluginRoot)).toBe("gpt-5.6-sol")
  })

  test("returns undefined when no config file exists", async () => {
    expect(await loadModelOverride(pluginRoot)).toBeUndefined()
  })

  test("ignores directories whose package.json belongs to another package", async () => {
    // A consumer project's own package.json must never be mistaken for the plugin root.
    await fs.writeFile(path.join(pluginRoot, "package.json"), '{"name":"some-consumer-app"}')
    await writeConfig('{"model":"gpt-5.6-sol"}')
    expect(await loadModelOverride(pluginRoot)).toBeUndefined()
  })

  test("gives up past the walk-up limit", async () => {
    const deep = path.join(pluginRoot, "a", "b", "c", "d", "e", "f", "g")
    await fs.mkdir(deep, { recursive: true })
    await writeConfig('{"model":"gpt-5.6-sol"}')
    expect(await loadModelOverride(deep)).toBeUndefined()
  })

  test("strips a UTF-8 BOM before parsing", async () => {
    await writeConfig("﻿{\"model\":\"gpt-5.6-sol\"}")
    expect(await loadModelOverride(pluginRoot)).toBe("gpt-5.6-sol")
  })

  test("throws with a clear message on invalid JSON", async () => {
    await writeConfig("{not json")
    expect(loadModelOverride(pluginRoot)).rejects.toThrow("gpt-imagegen.config.json is not valid JSON")
  })

  test("throws when the file is valid JSON but not an object", async () => {
    await writeConfig('"gpt-5.6-sol"')
    expect(loadModelOverride(pluginRoot)).rejects.toThrow("must be an object")
  })

  test("throws when the model field is missing", async () => {
    await writeConfig('{"other":1}')
    expect(loadModelOverride(pluginRoot)).rejects.toThrow('requires a non-empty string "model"')
  })

  test("throws when the model field is not a string", async () => {
    await writeConfig('{"model":42}')
    expect(loadModelOverride(pluginRoot)).rejects.toThrow('requires a non-empty string "model"')
  })

  test("throws when the model field is an empty string", async () => {
    await writeConfig('{"model":""}')
    expect(loadModelOverride(pluginRoot)).rejects.toThrow('requires a non-empty string "model"')
  })

  test("allows // line comments", async () => {
    await writeConfig('{\n// pick one of the slugs below\n"model": "gpt-5.6-sol" // trailing comment\n}')
    expect(await loadModelOverride(pluginRoot)).toBe("gpt-5.6-sol")
  })

  test("allows /* */ block comments", async () => {
    await writeConfig('{/* "model": "gpt-6-astra", */"model": "gpt-5.6-sol"}')
    expect(await loadModelOverride(pluginRoot)).toBe("gpt-5.6-sol")
  })

  test("ignores comment markers inside string values", async () => {
    await writeConfig('{"model": "gpt-5.6-sol", "note": "see https://example.com/a/*b*/c // not a comment"}')
    expect(await loadModelOverride(pluginRoot)).toBe("gpt-5.6-sol")
  })

  test("handles escaped quotes before a comment marker", async () => {
    await writeConfig('{"model": "gpt-5.6-sol", "note": "quoted \\" // still a string"}')
    expect(await loadModelOverride(pluginRoot)).toBe("gpt-5.6-sol")
  })

  test("rejects an unterminated block comment as invalid JSON", async () => {
    await writeConfig('{"model": "gpt-5.6-sol" /* oops')
    expect(loadModelOverride(pluginRoot)).rejects.toThrow("is not valid JSON")
  })

  test("reports a commented-out model as missing", async () => {
    await writeConfig('{\n// "model": "gpt-5.6-sol"\n}')
    expect(loadModelOverride(pluginRoot)).rejects.toThrow('requires a non-empty string "model"')
  })
})
