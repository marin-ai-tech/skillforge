// Plugin fixture: without the mcp capability ctx.mcp is absent, so this register() fails (plugin-mcp-tools).
export async function register(ctx) {
  ctx.mcp.tool(
    { name: "nocap_tool", description: "Never registered.", inputSchema: { type: "object" } },
    async () => ({}),
  );
}
