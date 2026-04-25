# Career-Ops Chrome Extension - Setup Guide

## Prerequisites

- Node.js 16+ (for daemon)
- Chrome/Edge browser
- Career-ops data directory at: `~/Documents/GitHub/career-ops/`

## Quick Start

### 1. Install Extension

```bash
cd /Users/jainamshah/Documents/GitHub/career-ops/extension

# Install dependencies
npm install

# Start daemon in one terminal
npm run daemon

# Build extension in another terminal
npm run build
```

### 2. Load in Chrome

1. Open `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top right)
3. Click **"Load unpacked"**
4. Select the `dist/` folder in the extension directory

### 3. Test It

1. Click the Career-Ops icon in Chrome toolbar
2. Sidebar should open with your postings list
3. If you see "No postings found", check:
   - Is daemon running? (`npm run daemon`)
   - Is `data/applications.md` readable?

## Project Structure

```
extension/
├── daemon/                 # Node.js server for file access
│   ├── server.js          # Express app (localhost:3737)
│   ├── fileReader.js      # Parse markdown/yaml
│   └── package.json       # Dependencies (express, cors)
├── src/
│   ├── background.js      # Service worker
│   ├── content.js         # Content script
│   ├── sidebar/           # React UI
│   └── utils/             # Parsers, detectors, generators
├── public/icons/          # Extension icons
├── package.json           # Extension dependencies (React, webpack)
├── webpack.config.js      # Build config
├── manifest.json          # Extension manifest (v3)
└── start.sh              # Launcher script
```

## Development Workflow

### Build Extension
```bash
npm run dev      # Watch mode (rebuilds on file change)
npm run build    # Production build (one-time)
```

### Start Daemon
```bash
npm run daemon   # Starts on localhost:3737
```

### Load in Chrome
1. Go to `chrome://extensions/`
2. Click refresh icon on Career-Ops card after making changes
3. Sidebar will reload

## Daemon API

The daemon exposes these endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Server health check |
| `GET /api/postings` | All postings from applications.md |
| `GET /api/report/:id` | Specific report (e.g., `001-anthropic-2024-04-20`) |
| `GET /api/cv` | CV markdown |
| `GET /api/profile` | Profile YAML |
| `GET /api/sync` | Full data sync (postings + reports + CV + profile) |

### Example Requests

```bash
# Check if daemon is running
curl http://localhost:3737/health

# Get all postings
curl http://localhost:3737/api/postings

# Get all data at once
curl http://localhost:3737/api/sync | jq .

# Get specific report
curl http://localhost:3737/api/report/001-anthropic-2024-04-20
```

## Troubleshooting

### "Failed to load data. Is the daemon running?"
- Make sure daemon is running: `npm run daemon`
- Check: `curl http://localhost:3737/health`

### "No postings found"
- Verify `~/Documents/GitHub/career-ops/data/applications.md` exists
- Check daemon logs for errors

### "Report not found"
- Verify report file exists in `~/Documents/GitHub/career-ops/reports/`
- Check the report filename (should be like `001-company-2024-04-20.md`)

### Extension not loading?
- Check Chrome console: `chrome://extensions/ → Details → Errors`
- Rebuild: `npm run build`
- Refresh extension: click refresh icon on extension card

### Webpack build errors?
- Clear cache: `rm -rf dist node_modules`
- Reinstall: `npm install`
- Rebuild: `npm run build`

## Architecture Overview

```
Chrome Extension                  Node.js Daemon
┌─────────────────────┐          ┌──────────────────┐
│ Sidebar (React)     │          │ Express Server   │
│ └─> App.jsx         │          │ (localhost:3737) │
└──────────┬──────────┘          │ └─> fileReader.js│
           │                      │ └─> Career-Ops   │
           │ sends message        │     Files        │
           ▼                      └──────────────────┘
┌──────────────────────┐                ▲
│ Service Worker       │                │
│ (background.js)      │◄───────────────┤ REST API
│ └─> loadCareerOpsData│                │
└──────────────────────┘                │
           │ delegates               localhost:3737
           ▼
┌──────────────────────┐
│ Content Script       │
│ (content.js)         │
│ └─> Form filling     │
└──────────────────────┘
```

## Phase Checklist

- ✅ **Phase 1**: Project structure, manifest, build config
- ✅ **Phase 2**: Data loading via daemon
- ⏳ **Phase 3**: Form detection + autofill
- ⏳ **Phase 4**: CV generation
- ⏳ **Phase 5**: ATS compatibility + edge cases

## Next Steps

1. **Test data loading**:
   ```bash
   npm run daemon
   npm run build
   # Load extension in Chrome
   # Check sidebar for postings list
   ```

2. **Implement form detection** (Phase 3):
   - Detect ATS type on page
   - Extract form fields
   - Map to report sections

3. **Add autofill** (Phase 4):
   - Generate answers per field
   - Populate form
   - Show review panel

4. **Implement CV generation** (Phase 5):
   - Extract JD keywords
   - Generate optimized PDF
   - Upload to form

## Support

Check daemon logs for errors:
```bash
# Terminal running daemon will show:
# [Daemon] Fetching report...
# [Daemon] Error reading postings: ENOENT ...
```

Check extension logs in Chrome:
```
chrome://extensions/ → Career-Ops → Details → Errors
```
