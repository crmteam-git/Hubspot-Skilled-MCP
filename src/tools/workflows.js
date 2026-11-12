// Workflow / automation tools built on the HubSpot Automation API v4 (flows).
// Docs: https://developers.hubspot.com/docs/api-reference/automation-automation-v4-v4/guide
import { z } from "zod";
import { hubspot, paginate, assertWritable } from "../hubspot.js";
import { safe, parseJsonArg } from "../util.js";

const FLOWS = "/automation/v4/flows";
const READ_ONLY_FIELDS = ["id", "createdAt", "updatedAt"];

async function listAllFlows(max = 2000) {
  return paginate(FLOWS, { query: { limit: 100 }, max });
}

async function getFlow(flowId) {
  return hubspot("GET", `${FLOWS}/${encodeURIComponent(flowId)}`);
}

async function getFlowsDetailed(ids) {
  // Batch read in chunks of 25 (HubSpot's limit for flows/batch/read).
  const out = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const res = await hubspot("POST", `${FLOWS}/batch/read`, {
      body: { inputs: chunk.map((flowId) => ({ flowId: String(flowId), type: "FLOW_ID" })) },
    });
    out.push(...(res.results || []));
  }
  return out;
}

function toUpdateBody(flow, changes = {}) {
  const body = { ...flow, ...changes, revisionId: flow.revisionId };
  for (const f of READ_ONLY_FIELDS) delete body[f];
  return body;
}

function summarize(flow) {
  return {
    id: flow.id,
    name: flow.name,
    isEnabled: flow.isEnabled,
    flowType: flow.flowType,
    type: flow.type,
    objectTypeId: flow.objectTypeId,
    revisionId: flow.revisionId,
    actionCount: Array.isArray(flow.actions) ? flow.actions.length : undefined,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  };
}

export function registerWorkflowTools(server) {
  server.registerTool(
    "list_workflows",
    {
      title: "List workflows",
      description:
        "List HubSpot workflows (automation v4 flows) with optional filters on enabled status, object type and name.",
      inputSchema: {
        enabled: z.boolean().optional().describe("Only return enabled (true) or disabled (false) workflows."),
        objectTypeId: z.string().optional().describe("e.g. 0-1 contacts, 0-2 companies, 0-3 deals, 0-5 tickets."),
        nameContains: z.string().optional().describe("Case-insensitive substring match on the workflow name."),
        limit: z.number().int().min(1).max(2000).optional().describe("Max workflows to return (default 500)."),
      },
    },
    safe(async ({ enabled, objectTypeId, nameContains, limit = 500 }) => {
      let flows = await listAllFlows(2000);
      if (enabled !== undefined) flows = flows.filter((f) => f.isEnabled === enabled);
      if (objectTypeId) flows = flows.filter((f) => f.objectTypeId === objectTypeId);
      if (nameContains) {
        const n = nameContains.toLowerCase();
        flows = flows.filter((f) => (f.name || "").toLowerCase().includes(n));
      }
      return { total: flows.length, workflows: flows.slice(0, limit).map(summarize) };
    })
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get workflow",
      description:
        "Get the full definition of one workflow: enrollment criteria, actions, branches, settings and revisionId.",
      inputSchema: { flowId: z.string().describe("The workflow (flow) ID.") },
    },
    safe(({ flowId }) => getFlow(flowId))
  );

  server.registerTool(
    "audit_workflows",
    {
      title: "Audit workflows",
      description:
        "Health-check all workflows and flag issues: disabled, no actions, no enrollment trigger, duplicate names, and not edited in N days.",
      inputSchema: {
        staleDays: z.number().int().min(1).optional().describe("Flag workflows not updated in this many days (default 180)."),
        includeDisabled: z.boolean().optional().describe("Include disabled workflows in the deep checks (default true)."),
      },
    },
    safe(async ({ staleDays = 180, includeDisabled = true }) => {
      const flows = await listAllFlows(2000);
      const targets = includeDisabled ? flows : flows.filter((f) => f.isEnabled);
      const detailed = await getFlowsDetailed(targets.map((f) => f.id));

      const cutoff = Date.now() - staleDays * 86400000;
      const nameCount = {};
      for (const f of flows) nameCount[(f.name || "").trim().toLowerCase()] = (nameCount[(f.name || "").trim().toLowerCase()] || 0) + 1;

      const issues = [];
      for (const f of detailed) {
        const problems = [];
        if (!f.isEnabled) problems.push("disabled");
        if (!Array.isArray(f.actions) || f.actions.length === 0) problems.push("no actions");
        if (f.flowType === "WORKFLOW" && !f.enrollmentCriteria) problems.push("no enrollment trigger (manual-only)");
        if (nameCount[(f.name || "").trim().toLowerCase()] > 1) problems.push("duplicate name");
        if (f.updatedAt && new Date(f.updatedAt).getTime() < cutoff) problems.push(`not updated in ${staleDays}+ days`);
        if (problems.length) issues.push({ id: f.id, name: f.name, isEnabled: f.isEnabled, problems });
      }

      return {
        totalWorkflows: flows.length,
        enabled: flows.filter((f) => f.isEnabled).length,
        disabled: flows.filter((f) => !f.isEnabled).length,
        checked: detailed.length,
        workflowsWithIssues: issues.length,
        issues,
      };
    })
  );

  server.registerTool(
    "search_workflows",
    {
      title: "Search inside workflows",
      description:
        "Find workflows whose definition references a value — e.g. a property name, email ID, list ID, owner ID or URL. Scans each workflow's full JSON.",
      inputSchema: {
        searchText: z.string().min(1).describe("Text to look for, e.g. 'lifecyclestage' or an email ID."),
        enabledOnly: z.boolean().optional(),
      },
    },
    safe(async ({ searchText, enabledOnly = false }) => {
      let flows = await listAllFlows(2000);
      if (enabledOnly) flows = flows.filter((f) => f.isEnabled);
      const detailed = await getFlowsDetailed(flows.map((f) => f.id));
      const needle = searchText.toLowerCase();
      const matches = [];
      for (const f of detailed) {
        const hits = [];
        if (JSON.stringify(f.enrollmentCriteria || {}).toLowerCase().includes(needle)) hits.push("enrollmentCriteria");
        for (const a of f.actions || []) {
          if (JSON.stringify(a).toLowerCase().includes(needle)) hits.push(`action ${a.actionId} (${a.actionTypeId || a.type})`);
        }
        if (!hits.length && JSON.stringify(f).toLowerCase().includes(needle)) hits.push("other settings");
        if (hits.length) matches.push({ id: f.id, name: f.name, isEnabled: f.isEnabled, foundIn: hits });
      }
      return { searched: detailed.length, matchCount: matches.length, matches };
    })
  );

  server.registerTool(
    "set_workflow_enabled",
    {
      title: "Turn workflow on/off",
      description: "Enable or disable a workflow.",
      inputSchema: { flowId: z.string(), enabled: z.boolean() },
    },
    safe(async ({ flowId, enabled }) => {
      assertWritable();
      const flow = await getFlow(flowId);
      if (flow.isEnabled === enabled) return { message: `Workflow already ${enabled ? "enabled" : "disabled"}.`, workflow: summarize(flow) };
      const updated = await hubspot("PUT", `${FLOWS}/${encodeURIComponent(flowId)}`, {
        body: toUpdateBody(flow, { isEnabled: enabled }),
      });
      return { message: `Workflow ${enabled ? "enabled" : "disabled"}.`, workflow: summarize(updated) };
    })
  );

  server.registerTool(
    "update_workflow",
    {
      title: "Update workflow",
      description:
        "Update a workflow. Fetches the current definition, merges your top-level changes (e.g. name, actions, enrollmentCriteria, timeWindows, blockedDates, suppressionListIds) and PUTs it with the current revisionId. Use get_workflow first to see the structure. Set dryRun=true to preview the payload without saving.",
      inputSchema: {
        flowId: z.string(),
        changes: z
          .union([z.record(z.any()), z.string()])
          .describe("Object (or JSON string) of top-level fields to replace on the workflow."),
        dryRun: z.boolean().optional().describe("Preview only; do not save (default false)."),
      },
    },
    safe(async ({ flowId, changes, dryRun = false }) => {
      const parsed = parseJsonArg(changes, "changes") || {};
      const flow = await getFlow(flowId);
      const body = toUpdateBody(flow, parsed);
      if (dryRun) return { dryRun: true, changedFields: Object.keys(parsed), payload: body };
      assertWritable();
      const updated = await hubspot("PUT", `${FLOWS}/${encodeURIComponent(flowId)}`, { body });
      return { message: "Workflow updated.", changedFields: Object.keys(parsed), workflow: summarize(updated) };
    })
  );

  server.registerTool(
    "create_workflow",
    {
      title: "Create workflow",
      description:
        "Create a new workflow from a full v4 flow definition (type, objectTypeId, flowType, name, actions, enrollmentCriteria, ...). Created disabled unless isEnabled=true is in the definition.",
      inputSchema: {
        definition: z.union([z.record(z.any()), z.string()]).describe("Flow definition object or JSON string."),
      },
    },
    safe(async ({ definition }) => {
      assertWritable();
      const body = { isEnabled: false, ...parseJsonArg(definition, "definition") };
      const created = await hubspot("POST", FLOWS, { body });
      return { message: "Workflow created.", workflow: summarize(created) };
    })
  );

  server.registerTool(
    "clone_workflow",
    {
      title: "Clone workflow",
      description: "Duplicate an existing workflow under a new name. The copy is created disabled.",
      inputSchema: { flowId: z.string(), newName: z.string().optional() },
    },
    safe(async ({ flowId, newName }) => {
      assertWritable();
      const flow = await getFlow(flowId);
      const body = { ...flow, name: newName || `${flow.name} (copy)`, isEnabled: false };
      for (const f of [...READ_ONLY_FIELDS, "revisionId"]) delete body[f];
      const created = await hubspot("POST", FLOWS, { body });
      return { message: "Workflow cloned (disabled).", workflow: summarize(created) };
    })
  );

  server.registerTool(
    "delete_workflow",
    {
      title: "Delete workflow",
      description: "Permanently delete a workflow. HubSpot cannot restore it via API — prefer set_workflow_enabled(false).",
      inputSchema: { flowId: z.string(), confirm: z.literal(true).describe("Must be true to delete.") },
    },
    safe(async ({ flowId }) => {
      assertWritable();
      await hubspot("DELETE", `${FLOWS}/${encodeURIComponent(flowId)}`);
      return { message: `Workflow ${flowId} deleted.` };
    })
  );

  server.registerTool(
    "enroll_contact_in_workflow",
    {
      title: "Enroll / unenroll contact",
      description:
        "Manually enroll (or unenroll) a contact by email in a contact-based workflow. Uses the legacy v2 enrollment API, which takes the legacy workflow ID (shown in the workflow URL in older portals).",
      inputSchema: {
        workflowId: z.string().describe("Legacy (v2/v3) workflow ID."),
        email: z.string().email(),
        action: z.enum(["enroll", "unenroll"]).optional().describe("Default: enroll."),
      },
    },
    safe(async ({ workflowId, email, action = "enroll" }) => {
      assertWritable();
      const path = `/automation/v2/workflows/${encodeURIComponent(workflowId)}/enrollments/contacts/${encodeURIComponent(email)}`;
      await hubspot(action === "enroll" ? "POST" : "DELETE", path);
      return { message: `Contact ${email} ${action}ed ${action === "enroll" ? "in" : "from"} workflow ${workflowId}.` };
    })
  );
}
