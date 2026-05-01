import { describe, expect, it } from "bun:test";
import NovelClusterPlugin from "./index";

describe("NovelClusterPlugin", () => {
  // #given the plugin function is imported
  // #when it is called with a mock context
  // #then it returns an object with config, tool, and hook lifecycle methods
  it("returns object with config, tool, and hook lifecycle methods", async () => {
    const plugin = await NovelClusterPlugin({
      project: {},
      client: {},
      $: {},
      directory: "/tmp/test",
      worktree: true,
    } as never);

    expect(plugin).toHaveProperty("config");
    expect(typeof plugin.config).toBe("function");

    expect(plugin).toHaveProperty("tool");
    expect(Object.keys(plugin.tool ?? {})).toHaveLength(11);

    expect(plugin).toHaveProperty(["chat.message"]);
    expect(typeof plugin["chat.message"]).toBe("function");

    expect(plugin).toHaveProperty(["event"]);
    expect(typeof plugin["event"]).toBe("function");

    expect(plugin).toHaveProperty(["tool.execute.before"]);
    expect(typeof plugin["tool.execute.before"]).toBe("function");

    expect(plugin).toHaveProperty(["tool.execute.after"]);
    expect(typeof plugin["tool.execute.after"]).toBe("function");
  });

  // #given the plugin function is imported
  // #when it is called
  // #then it does not throw
  it("initializes without throwing", async () => {
    await expect(
      NovelClusterPlugin({
        project: {},
        client: {},
        $: {},
        directory: "/tmp/test",
        worktree: true,
      } as never)
    ).resolves.toBeDefined();
  });
});
