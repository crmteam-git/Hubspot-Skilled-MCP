// Core CRM tools: records, search, properties, owners, pipelines, associations, notes.
import { z } from "zod";
import { hubspot, paginate, assertWritable } from "../hubspot.js";
import { safe, parseJsonArg } from "../util.js";

const objectType = z
  .string()
  .describe("Object type: contacts, companies, deals, tickets, products, line_items, quotes, or a custom object ID like 2-12345.");

export function registerCrmTools(server) {
  server.registerTool(
    "get_account_info",
    {
      title: "Account info",
      description: "Check the connection and show portal ID, time zone and currency of the HubSpot account.",
      inputSchema: {},
    },
    safe(() => hubspot("GET", "/account-info/v3/details"))
  );

  server.registerTool(
    "search_records",
    {
      title: "Search CRM records",
      description:
        "Search any CRM object. Use `query` for free text and/or `filters` (ANDed) like [{propertyName:'email', operator:'EQ', value:'a@b.com'}]. Operators: EQ, NEQ, LT, LTE, GT, GTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN.",
      inputSchema: {
        objectType,
        query: z.string().optional(),
        filters: z
          .array(
            z.object({
              propertyName: z.string(),
              operator: z.string(),
              value: z.any().optional(),
              values: z.array(z.any()).optional(),
              highValue: z.any().optional(),
            })
          )
          .optional(),
        properties: z.array(z.string()).optional().describe("Properties to return."),
        sortBy: z.string().optional(),
        sortDirection: z.enum(["ASCENDING", "DESCENDING"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        after: z.string().optional().describe("Paging cursor from a previous call."),
      },
    },
    safe(({ objectType, query, filters, properties, sortBy, sortDirection = "DESCENDING", limit = 20, after }) =>
      hubspot("POST", `/crm/v3/objects/${objectType}/search`, {
        body: {
          query,
          filterGroups: filters?.length ? [{ filters }] : undefined,
          properties,
          sorts: sortBy ? [{ propertyName: sortBy, direction: sortDirection }] : undefined,
          limit,
          after,
        },
      })
    )
  );

  server.registerTool(
    "get_record",
    {
      title: "Get CRM record",
      description: "Get one CRM record by ID (or by a unique property via idProperty, e.g. email).",
      inputSchema: {
        objectType,
        id: z.string(),
        idProperty: z.string().optional(),
        properties: z.array(z.string()).optional(),
        associations: z.array(z.string()).optional().describe("Object types whose associated IDs to include."),
      },
    },
    safe(({ objectType, id, idProperty, properties, associations }) =>
      hubspot("GET", `/crm/v3/objects/${objectType}/${encodeURIComponent(id)}`, {
        query: {
          idProperty,
          properties: properties?.join(","),
          associations: associations?.join(","),
        },
      })
    )
  );

  server.registerTool(
    "create_record",
    {
      title: "Create CRM record",
      description: "Create a CRM record with the given properties.",
      inputSchema: {
        objectType,
        properties: z.union([z.record(z.any()), z.string()]),
      },
    },
    safe(({ objectType, properties }) => {
      assertWritable();
      return hubspot("POST", `/crm/v3/objects/${objectType}`, {
        body: { properties: parseJsonArg(properties, "properties") },
      });
    })
  );

  server.registerTool(
    "update_record",
    {
      title: "Update CRM record",
      description: "Update properties on a CRM record.",
      inputSchema: {
        objectType,
        id: z.string(),
        properties: z.union([z.record(z.any()), z.string()]),
      },
    },
    safe(({ objectType, id, properties }) => {
      assertWritable();
      return hubspot("PATCH", `/crm/v3/objects/${objectType}/${encodeURIComponent(id)}`, {
        body: { properties: parseJsonArg(properties, "properties") },
      });
    })
  );

  server.registerTool(
    "archive_record",
    {
      title: "Archive CRM record",
      description: "Archive (soft delete) a CRM record. It can be restored from the HubSpot recycle bin for 90 days.",
      inputSchema: { objectType, id: z.string() },
    },
    safe(async ({ objectType, id }) => {
      assertWritable();
      await hubspot("DELETE", `/crm/v3/objects/${objectType}/${encodeURIComponent(id)}`);
      return { message: `${objectType} ${id} archived.` };
    })
  );

  server.registerTool(
    "list_properties",
    {
      title: "List properties",
      description: "List property definitions for an object type (name, label, type, options).",
      inputSchema: {
        objectType,
        nameContains: z.string().optional(),
        customOnly: z.boolean().optional().describe("Only non-HubSpot-defined properties."),
      },
    },
    safe(async ({ objectType, nameContains, customOnly }) => {
      const res = await hubspot("GET", `/crm/v3/properties/${objectType}`);
      let props = res.results || [];
      if (customOnly) props = props.filter((p) => !p.hubspotDefined);
      if (nameContains) {
        const n = nameContains.toLowerCase();
        props = props.filter((p) => p.name.toLowerCase().includes(n) || (p.label || "").toLowerCase().includes(n));
      }
      return {
        total: props.length,
        properties: props.map((p) => ({
          name: p.name,
          label: p.label,
          type: p.type,
          fieldType: p.fieldType,
          groupName: p.groupName,
          hubspotDefined: p.hubspotDefined,
          options: p.options?.length ? p.options.map((o) => o.value) : undefined,
        })),
      };
    })
  );

  server.registerTool(
    "list_owners",
    {
      title: "List owners",
      description: "List HubSpot users/owners (ID, name, email, teams).",
      inputSchema: { email: z.string().optional() },
    },
    safe(async ({ email }) => {
      const owners = await paginate("/crm/v3/owners", { query: { limit: 100, email } });
      return owners.map((o) => ({ id: o.id, email: o.email, firstName: o.firstName, lastName: o.lastName, teams: o.teams?.map((t) => t.name) }));
    })
  );

  server.registerTool(
    "list_pipelines",
    {
      title: "List pipelines",
      description: "List pipelines and stages for deals, tickets or another pipeline object.",
      inputSchema: { objectType: z.string().describe("deals or tickets (or a custom object ID).") },
    },
    safe(async ({ objectType }) => {
      const res = await hubspot("GET", `/crm/v3/pipelines/${objectType}`);
      return (res.results || []).map((p) => ({
        id: p.id,
        label: p.label,
        stages: p.stages.map((s) => ({ id: s.id, label: s.label, displayOrder: s.displayOrder, metadata: s.metadata })),
      }));
    })
  );

  server.registerTool(
    "get_associations",
    {
      title: "Get associations",
      description: "List records of one type associated with a record (e.g. the contacts on a deal).",
      inputSchema: { fromObjectType: objectType, fromId: z.string(), toObjectType: objectType },
    },
    safe(({ fromObjectType, fromId, toObjectType }) =>
      paginate(`/crm/v4/objects/${fromObjectType}/${encodeURIComponent(fromId)}/associations/${toObjectType}`, {
        query: { limit: 500 },
      })
    )
  );

  server.registerTool(
    "create_association",
    {
      title: "Associate records",
      description: "Create the default association between two records (e.g. contact ↔ company).",
      inputSchema: { fromObjectType: objectType, fromId: z.string(), toObjectType: objectType, toId: z.string() },
    },
    safe(({ fromObjectType, fromId, toObjectType, toId }) => {
      assertWritable();
      return hubspot(
        "PUT",
        `/crm/v4/objects/${fromObjectType}/${encodeURIComponent(fromId)}/associations/default/${toObjectType}/${encodeURIComponent(toId)}`
      );
    })
  );

  server.registerTool(
    "add_note",
    {
      title: "Add note",
      description: "Create a note and attach it to a contact, company, deal or ticket.",
      inputSchema: {
        objectType: z.enum(["contacts", "companies", "deals", "tickets"]),
        id: z.string(),
        body: z.string().describe("Note text (HTML allowed)."),
        ownerId: z.string().optional(),
      },
    },
    safe(async ({ objectType, id, body, ownerId }) => {
      assertWritable();
      const note = await hubspot("POST", "/crm/v3/objects/notes", {
        body: {
          properties: { hs_note_body: body, hs_timestamp: new Date().toISOString(), hubspot_owner_id: ownerId },
        },
      });
      await hubspot(
        "PUT",
        `/crm/v4/objects/notes/${note.id}/associations/default/${objectType}/${encodeURIComponent(id)}`
      );
      return { message: "Note added.", noteId: note.id };
    })
  );

  server.registerTool(
    "list_lists",
    {
      title: "Search lists",
      description: "Search HubSpot lists (segments) by name — useful for checking lists referenced in workflows.",
      inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(500).optional() },
    },
    safe(({ query, limit = 50 }) =>
      hubspot("POST", "/crm/v3/lists/search", { body: { query, count: limit } })
    )
  );

  server.registerTool(
    "hubspot_api_request",
    {
      title: "Raw HubSpot API request",
      description:
        "Escape hatch: call any HubSpot API endpoint (path like /crm/v3/objects/contacts). Non-GET methods are blocked in read-only mode.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().startsWith("/"),
        query: z.record(z.any()).optional(),
        body: z.union([z.record(z.any()), z.array(z.any()), z.string()]).optional(),
      },
    },
    safe(({ method, path, query, body }) => {
      if (method !== "GET") assertWritable();
      return hubspot(method, path, { query, body: parseJsonArg(body, "body") });
    })
  );
}
