// Plugin fixture: the extension contract for MCP tools of a plugin (plugin-mcp-tools).
// The platform must make this file work exactly as written.
const OBJECT = { type: "object", properties: {}, additionalProperties: false };

export async function register(ctx) {
  ctx.mcp.tool(
    {
      name: "probe_echo",
      description: "Echo the text back with the name of the caller.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    async (args, call) => {
      if (typeof args.text !== "string") throw new Error("text must be a string");
      return { echo: args.text, user: call.caller.username, integration: call.caller.integration };
    },
  );

  // Reads go through the built-in tools as the caller: the plugin sees exactly what the token sees.
  ctx.mcp.tool(
    { name: "probe_find", description: "Names of the skills this caller can see over MCP.", inputSchema: OBJECT },
    async (_args, call) => {
      const found = await call.registry("search_artifacts", { type: "skill", limit: 50 });
      return { names: found.items.map((item) => item.name).sort() };
    },
  );

  ctx.mcp.tool(
    { name: "probe_fail", description: "Always fails.", inputSchema: OBJECT },
    async () => {
      throw new Error("probe failure on purpose");
    },
  );

  // Only an integration token sees this one; usage goes through record_usage as the caller.
  ctx.mcp.tool(
    {
      name: "probe_report",
      description: "Report one assigned use of a skill.",
      audience: "integration",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    async (args, call) =>
      call.registry("record_usage", {
        type: "skill",
        name: args.name,
        uses: 1,
        helped: 1,
        basis: "assigned",
        report_id: `probe-${args.name}`,
      }),
  );
}
