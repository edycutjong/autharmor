#!/usr/bin/env npx tsx
/**
 * Golden Path Demo Script for AuthArmor
 *
 * Starts a mock FHIR server from synthetic data, then calls the AuthArmor
 * MCP server through all 3 tools end-to-end. Use this before recording
 * the demo video to ensure zero failures.
 *
 * Usage:
 *   npm run demo             # Run against localhost:3050
 *   npm run demo:ngrok       # Run against ngrok URL
 *
 * Prerequisites:
 *   1. AuthArmor server running: npm run start
 *   2. GEMINI_API_KEY configured in .env
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTHARMOR_URL = process.argv[2] || "http://localhost:3050";
const MOCK_FHIR_PORT = 9876;

// ─── Colors ──────────────────────────────────────────────────────────────────
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ─── Mock FHIR Server ───────────────────────────────────────────────────────
function startMockFhirServer(): Promise<http.Server> {
  const bundlePath = path.join(__dirname, "..", "data", "patient-ra-bundle.json");
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
  const resources = bundle.entry.map((e: { resource: unknown }) => e.resource);

  const server = http.createServer((req, res) => {
    const url = req.url || "";
    res.setHeader("Content-Type", "application/fhir+json");

    // GET /Patient/{id}
    const patientMatch = url.match(/^\/Patient\/(.+?)(\?|$)/);
    if (patientMatch) {
      const patient = resources.find(
        (r: { resourceType: string; id: string }) =>
          r.resourceType === "Patient" && r.id === patientMatch[1],
      );
      if (patient) {
        res.writeHead(200);
        res.end(JSON.stringify(patient));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ issue: [{ severity: "error", code: "not-found" }] }));
      return;
    }

    // GET /{ResourceType}?patient=Patient/{id}&...
    const searchMatch = url.match(/^\/(\w+)\?(.+)$/);
    if (searchMatch) {
      const resourceType = searchMatch[1];
      const matching = resources.filter(
        (r: { resourceType: string }) => r.resourceType === resourceType,
      );
      const responseBundle = {
        resourceType: "Bundle",
        type: "searchset",
        total: matching.length,
        entry: matching.map((r: unknown) => ({ resource: r })),
      };
      res.writeHead(200);
      res.end(JSON.stringify(responseBundle));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ issue: [{ severity: "error", code: "not-found" }] }));
  });

  return new Promise((resolve) => {
    server.listen(MOCK_FHIR_PORT, () => {
      console.log(dim(`  Mock FHIR server on http://localhost:${MOCK_FHIR_PORT}`));
      resolve(server);
    });
  });
}

// ─── MCP Call Helper ─────────────────────────────────────────────────────────
let mcpRequestId = 0;

function parseSseResponse(text: string): unknown {
  // Extract JSON from SSE event stream
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.substring(6));
      } catch { /* skip */ }
    }
  }
  // Try direct JSON parse
  try { return JSON.parse(text); } catch { return null; }
}

async function mcpInitialize(): Promise<void> {
  const response = await fetch(`${AUTHARMOR_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "x-fhir-server-url": `http://localhost:${MOCK_FHIR_PORT}`,
      "x-patient-id": "patient-sarah-chen",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "golden-path-demo", version: "1.0.0" },
      },
      id: ++mcpRequestId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Initialize failed: ${response.status} ${response.statusText} ${body}`);
  }
}

async function mcpCallTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(`${AUTHARMOR_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "x-fhir-server-url": `http://localhost:${MOCK_FHIR_PORT}`,
      "x-patient-id": "patient-sarah-chen",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: args },
      id: ++mcpRequestId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tool call failed: ${response.status} ${body}`);
  }

  const text = await response.text();
  const json = parseSseResponse(text) as Record<string, unknown> | null;

  if (!json) {
    return text;
  }

  // Extract content from MCP response
  const result = json.result as { content?: Array<{ text?: string }> } | undefined;
  if (result?.content) {
    return result.content
      .map((c: { text?: string }) => c.text || "")
      .join("\n");
  }

  return JSON.stringify(json, null, 2);
}

// ─── Demo Steps ──────────────────────────────────────────────────────────────

async function step(
  num: number,
  title: string,
  fn: () => Promise<string>,
): Promise<string> {
  const stepLabel = cyan(`[Step ${num}]`);
  console.log(`\n${stepLabel} ${bold(title)}`);

  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    console.log(green(`  ✅ Success`) + dim(` (${elapsed}ms)`));

    // Print first 500 chars of result
    const preview = result.length > 500 ? result.substring(0, 500) + "..." : result;
    for (const line of preview.split("\n")) {
      console.log(dim(`  │ ${line}`));
    }

    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    console.log(red(`  ❌ FAILED`) + dim(` (${elapsed}ms)`));
    console.error(red(`  ${error instanceof Error ? error.message : String(error)}`));
    throw error;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(bold("\n🛡️  AuthArmor — Golden Path Demo\n"));
  console.log(`  Target: ${cyan(AUTHARMOR_URL)}`);

  // 1. Start mock FHIR server
  const fhirServer = await startMockFhirServer();

  let passed = 0;
  let failed = 0;

  try {
    // 2. Health check
    await step(1, "Health Check", async () => {
      const res = await fetch(`${AUTHARMOR_URL}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== "ok") throw new Error("Health check returned non-ok status");
      if (!data.tools || data.tools.length < 3)
        throw new Error(`Expected 3+ tools, got ${data.tools?.length}`);
      return JSON.stringify(data, null, 2);
    });
    passed++;

    // 3. MCP Initialize
    await step(2, "MCP Initialize", async () => {
      await mcpInitialize();
      return "Session initialized successfully";
    });
    passed++;

    // 4. CheckAuthStatus
    await step(3, "CheckAuthStatus — Find Humira denial", async () => {
      return await mcpCallTool("CheckAuthStatus", {
        patientId: "patient-sarah-chen",
        medicationName: "Humira",
      });
    });
    passed++;

    // 5. GenerateAppeal
    const appealText = await step(
      4,
      "GenerateAppeal — Draft citation-driven appeal",
      async () => {
        return await mcpCallTool("GenerateAppeal", {
          patientId: "patient-sarah-chen",
          medicationName: "Humira",
          denialReason: "Step therapy requirement not met",
        });
      },
    );
    passed++;

    // 6. GetAppealPdf
    await step(5, "GetAppealPdf — Format appeal document", async () => {
      return await mcpCallTool("GetAppealPdf", {
        patientId: "patient-sarah-chen",
        appealText: appealText.substring(0, 2000), // Trim for safety
      });
    });
    passed++;

    // Summary
    console.log(
      `\n${bold("━━━ Results ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}`,
    );
    console.log(green(`  ✅ ${passed} passed`) + (failed ? red(` ❌ ${failed} failed`) : ""));
    console.log(bold(`\n🎬 Golden path verified — safe to record demo!\n`));
  } catch {
    failed++;
    console.log(
      `\n${bold("━━━ Results ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}`,
    );
    console.log(
      green(`  ✅ ${passed} passed`) + " " + red(`❌ ${failed} failed`),
    );
    console.log(
      yellow(`\n⚠️  Fix failures before recording!\n`),
    );
    process.exitCode = 1;
  } finally {
    fhirServer.close();
  }
}

main();
