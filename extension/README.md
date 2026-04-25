# Career-Ops Chrome Extension

## Quick Start

```bash
# Install dependencies
cd extension
npm install

# Build extension
npm run build

# Load in Chrome
# 1. Open chrome://extensions/
# 2. Enable "Developer mode" (top right)
# 3. Click "Load unpacked" 
# 4. Select ./dist directory
```

## Architecture

- **background.js** – Service worker (handles data loading, form detection, answer generation)
- **content.js** – Content script (injects into application pages, handles form interaction)
- **sidebar/** – React UI (browse postings, show detail, review before submit)
- **utils/** – Data parsers, form detectors, answer generators

## Development

```bash
npm run dev    # Watch mode - rebuild on file changes
npm run build  # Production build
npm run test   # Run tests (TODO)
```

## Permissions

- `tabs` – Access tab info for form filling
- `scripting` – Inject content scripts
- `storage` – Cache data locally
- `host_permissions` – Access job application domains (Greenhouse, Ashby, Lever, LinkedIn, custom)

## Status

- ✅ Phase 1 Complete: Project structure, manifest, build config
- 🟡 Phase 2 In Progress: Data parser, sidebar scaffolding
- ⏳ Phase 3 Todo: Form detection, autofill, CV generation, ATS compatibility
