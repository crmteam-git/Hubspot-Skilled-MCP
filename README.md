# HubSpot Skilled MCP

A custom MCP server (Node.js, stdio) that checks and updates HubSpot workflows and automations, and includes the core CRM tools.

## Setup

1. Create a HubSpot **Private App** (Settings → Integrations → Private Apps) with these scopes:
   - `automation` (workflows)
   - `crm.objects.contacts.read/write`, `crm.objects.companies.read/write`, `crm.objects.deals.read/write`
   - `crm.schemas.*.read`, `crm.objects.owners.read`, `crm.lists.read`, `tickets` (if you use tickets)
2. Put the token in `.env`: `HUBSPOT_ACCESS_TOKEN=pat-...`
3. `npm install`
4. Test with the MCP Inspector: `npm run inspect`

## Add it to Claude Code / Claude Desktop

```bash
claude mcp add hubspot-skilled -- node "C:/Users/webguruz/Documents/GitHub/Hubspot-Skilled-MCP/src/index.js"
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "hubspot-skilled": {
      "command": "node",
      "args": ["C:/Users/webguruz/Documents/GitHub/Hubspot-Skilled-MCP/src/index.js"]
    }
  }
}
```

The server reads `.env` from the project folder, so you don't have to put the token in the client config.

## Tools

### Workflows / automations (Automation API v4)
| Tool | What it does |
|---|---|
| `list_workflows` | List workflows, filtered by enabled status, object type or name |
| `get_workflow` | Full definition: triggers, actions, branches, revisionId |
| `audit_workflows` | Flags disabled, empty, trigger-less, duplicate-named and stale workflows |
| `search_workflows` | Finds workflows that reference a property, email ID, list ID, owner, URL… |
| `set_workflow_enabled` | Turn a workflow on or off |
| `update_workflow` | Merge changes into a workflow and save (supports `dryRun`) |
| `create_workflow` | Create a workflow from a v4 definition (disabled by default) |
| `clone_workflow` | Duplicate a workflow (copy is disabled) |
| `delete_workflow` | Permanently delete (requires `confirm: true`) |
| `enroll_contact_in_workflow` | Enroll/unenroll a contact by email (legacy v2 workflow ID) |

### CRM
`get_account_info`, `search_records`, `get_record`, `create_record`, `update_record`, `archive_record`, `list_properties`, `list_owners`, `list_pipelines`, `get_associations`, `create_association`, `add_note`, `list_lists`, `hubspot_api_request` (any endpoint).

## Safety
- `HUBSPOT_READ_ONLY=true` blocks every write tool, which is useful for audits.
- `update_workflow` always uses the current `revisionId`, so it fails instead of silently overwriting a workflow someone else edited in the meantime.
- Run `update_workflow` with `dryRun: true` first to preview the exact payload.
