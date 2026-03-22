# 🛡️ AuthArmor

**Citation-driven prior authorization appeals MCP server for healthcare AI agents.**

AuthArmor is a [SHARP-on-MCP](https://www.sharponmcp.com/) server that helps clinicians and care coordinators fight denied prior authorizations. It reads patient FHIR records, searches payer policies, and generates appeal letters backed by citations to specific clinical data — no hallucinations, no guesswork.

## 🎯 What It Does

| Tool | Description |
|---|---|
| `CheckAuthStatus` | Reads FHIR MedicationRequest + ClaimResponse to find denial details |
| `GenerateAppeal` | Drafts a citation-driven appeal letter using Gemini AI |
| `GetAppealPdf` | Returns the appeal text for download/export |

## 🏗️ Architecture

```
Prompt Opinion Platform
  ↓ POST /mcp (with SHARP headers)
AuthArmor MCP Server
  ├── FHIR Client → reads patient data from workspace FHIR server
  ├── Gemini AI → generates appeal with inline FHIR citations
  └── Returns structured appeal text to agent
```

## 🚀 Quick Start

### Prerequisites
- Node.js 22+
- [Gemini API key](https://aistudio.google.com/apikey) (free tier)

### Setup
```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# Start the server
npm run start
```

The server runs on `http://localhost:5000/mcp`.

### Connect to Prompt Opinion
1. Install ngrok: `brew install ngrok`
2. Expose your server: `ngrok http 5000`
3. In Prompt Opinion → Workspace Hub → Add MCP Server
4. Paste `{ngrok_url}/mcp` → check "Streamable HTTP" → check "FHIR context"
5. Click Test → verify tools appear → Save

## 🔬 SHARP-on-MCP Context

AuthArmor receives FHIR context via [SHARP](https://www.sharponmcp.com/) HTTP headers:

| Header | Purpose |
|---|---|
| `x-fhir-server-url` | FHIR server base URL |
| `x-fhir-access-token` | Bearer token for FHIR API calls |
| `x-patient-id` | Patient ID (fallback) |

## 📋 Hackathon

Built for [Agents Assemble — The Healthcare AI Endgame](https://agents-assemble.devpost.com/) (Track 1: MCP Superpower).

## 📄 License

MIT
