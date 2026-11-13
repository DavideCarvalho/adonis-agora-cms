---

## '@adonis-agora/cms': minor

The CMS registers its tools in the agora MCP hub (`/mcp/agora`, served by `@adonis-agora/agent/mcp_provider`) as the `cms` lib: `cms_list_collections`, `cms_get_collection`, `cms_list_documents`, `cms_get_document`, `cms_list_versions`, `cms_get_version` and `cms_get_global` (read), plus `cms_create_document`, `cms_update_document`, `cms_publish_document`, `cms_unpublish_document`, `cms_delete_document`, `cms_restore_version` and `cms_update_global` (action). Each call acts as the request's CMS principal, like the REST API, so access rules, drafts and locales apply; `devTools.authorize` in `config/mcp.ts` gates the lib.

The standalone `@adonis-agora/cms-mcp` package and the `cms:mcp` command are removed: point your MCP client at `/mcp/agora` instead (see `docs/mcp.md`).
