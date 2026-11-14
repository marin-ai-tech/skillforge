-- plugin-mcp-tools: an integration token sees MCP tools of plugins with the integration audience
ALTER TABLE api_tokens ADD COLUMN integration INTEGER NOT NULL DEFAULT 0;
