# mcp-memory-libsql

A high-performance, persistent memory system for the Model Context
Protocol (MCP) powered by libSQL. This server provides vector search
capabilities and efficient knowledge storage using libSQL as the
backing store.

<a href="https://glama.ai/mcp/servers/22lg4lq768">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/22lg4lq768/badge" alt="Glama badge" />
</a>

## Features

- 🚀 High-performance vector search using libSQL
- 💾 Persistent storage of entities and relations
- 🔍 Semantic search capabilities
- 🔄 Knowledge graph management
- 🌐 Compatible with local and remote libSQL databases
- 🔒 Secure token-based authentication for remote databases

## Configuration

This server is designed to be used as part of an MCP configuration.
Here are examples for different environments:

### Cline Configuration

Add this to your Cline MCP settings:

```json
{
	"mcpServers": {
		"mcp-memory-libsql": {
			"command": "npx",
			"args": ["-y", "mcp-memory-libsql"],
			"env": {
				"LIBSQL_URL": "file:/path/to/your/database.db"
			}
		}
	}
}
```

### Local Repository (Direct) Configuration

If you've cloned this repository and want to run the server directly from
your working copy (no npm install needed), build it once and point your
MCP client at the local entry point:

```bash
pnpm install
pnpm build   # creates dist/index.js
```

Then use an absolute path to this repo in your MCP config (works for
Cline, Claude Desktop, and other MCP clients):

```json
{
	"mcpServers": {
		"mcp-memory-libsql": {
			"command": "node",
			"args": [
				"/Users/your-username/personal/mcp-semantic-memory-libsql-v1/dist/index.js"
			],
			"cwd": "/Users/your-username/personal/mcp-semantic-memory-libsql-v1",
			"env": {
				"LIBSQL_URL": "file:/path/to/database.db"
			}
		}
	}
}
```

Development shortcut: if you prefer running the TypeScript entrypoint
without building, swap the `command`/`args` with:

```json
"command": "pnpm",
"args": ["dev"],
"cwd": "/Users/your-username/personal/mcp-semantic-memory-libsql-v1"
```

### Claude Desktop with WSL Configuration

For a detailed guide on setting up this server with Claude Desktop in
WSL, see
[Getting MCP Server Working with Claude Desktop in WSL](https://scottspence.com/posts/getting-mcp-server-working-with-claude-desktop-in-wsl).

Add this to your Claude Desktop configuration for WSL environments:

```json
{
	"mcpServers": {
		"mcp-memory-libsql": {
			"command": "wsl.exe",
			"args": [
				"bash",
				"-c",
				"source ~/.nvm/nvm.sh && LIBSQL_URL=file:/path/to/database.db /home/username/.nvm/versions/node/v20.12.1/bin/npx mcp-memory-libsql"
			]
		}
	}
}
```

### Database Configuration

The server supports both local SQLite and remote libSQL databases. Use
the `LIBSQL_URL` environment variable (with optional `LIBSQL_AUTH_TOKEN`).

For local SQLite databases:

```json
{
	"env": {
		"LIBSQL_URL": "file:/path/to/database.db"
	}
}
```

For remote libSQL databases (e.g., Turso):

```json
{
	"env": {
		"LIBSQL_URL": "libsql://your-database.turso.io",
		"LIBSQL_AUTH_TOKEN": "your-auth-token"
	}
}
```

Note: When using WSL, ensure the database path uses the Linux
filesystem format (e.g., `/home/username/...`) rather than Windows
format.

By default, if no URL is provided, it will use `file:memory.db` in the
current directory.

## API

The server implements the standard MCP memory interface with
additional vector search capabilities:

- Entity Management
  - Create/Update entities with embeddings
  - Delete entities
  - Search entities by similarity
- Relation Management
  - Create relations between entities
  - Delete relations
  - Query related entities

## Architecture

The server uses a libSQL database with the following schema:

- Entities table: Stores entity information and embeddings
- Relations table: Stores relationships between entities
- Vector search capabilities implemented using libSQL's built-in
  vector operations

## Development

### Publishing

Due to npm 2FA requirements, publishing needs to be done manually:

1. Create a changeset (documents your changes):

```bash
pnpm changeset
```

2. Version the package (updates version and CHANGELOG):

```bash
pnpm changeset version
```

3. Publish to npm (will prompt for 2FA code):

```bash
pnpm release
```

## Contributing

Contributions are welcome! Please read our contributing guidelines
before submitting pull requests.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built on the
  [Model Context Protocol](https://github.com/modelcontextprotocol)
- Powered by [libSQL](https://github.com/tursodatabase/libsql)
