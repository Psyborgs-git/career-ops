#!/usr/bin/env node

/**
 * Career-Ops Extension Daemon
 *
 * Runs locally (localhost:3737) to serve career-ops data files to the Chrome extension.
 * Reads from ~/Documents/GitHub/career-ops/ and exposes via REST API.
 *
 * Start: npm run daemon  (from extension/)
 * Or:    node daemon/server.js
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const {
  parseApplicationsTable,
  parseReport,
  parseProfile,
  updateApplicationStatus,
} = require('./fileReader.js');

const app = express();
const PORT = 3737;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11444';
const DEFAULT_CAREER_OPS_PATH = process.env.CAREER_OPS_PATH
  ? path.resolve(process.env.CAREER_OPS_PATH)
  : path.resolve(path.join(__dirname, '..', '..'));
let CAREER_OPS_PATH = DEFAULT_CAREER_OPS_PATH;

app.use(cors());
app.use(express.json());

console.log('[Daemon] Career-Ops Extension Server');
console.log(`[Daemon] Reading from: ${CAREER_OPS_PATH}`);

const DEFAULT_CONTEXT_FILES = [
  { path: 'cv.md', label: 'CV markdown' },
  { path: 'config/profile.yml', label: 'Candidate profile' },
  { path: 'modes/_profile.md', label: 'Personalized targeting guidance' },
  { path: 'interview-prep/story-bank.md', label: 'Interview story bank' },
  { path: 'article-digest.md', label: 'Article and proof-point digest' },
];

async function readOptionalWorkspaceFile(relativePath) {
  const absolutePath = path.join(CAREER_OPS_PATH, relativePath);
  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    return { path: relativePath, content };
  } catch {
    return null;
  }
}

async function buildContextBundle({ reportFilename } = {}) {
  const files = [];

  for (const entry of DEFAULT_CONTEXT_FILES) {
    const file = await readOptionalWorkspaceFile(entry.path);
    if (!file) continue;
    files.push({
      path: entry.path,
      label: entry.label,
      content: file.content,
    });
  }

  if (reportFilename) {
    const safe = reportFilename.replace(/[^a-zA-Z0-9._-]/g, '');
    const reportPath = safe.endsWith('.md') ? safe : `${safe}.md`;
    const report = await readOptionalWorkspaceFile(path.join('reports', reportPath));
    if (report) {
      files.unshift({
        path: report.path,
        label: 'Selected job report / JD context',
        content: report.content,
      });
    }
  }

  return {
    files,
    combinedContext: files
      .map(file => `### ${file.label} (${file.path})\n\n${file.content.trim()}`)
      .join('\n\n---\n\n'),
  };
}

function buildOllamaPrompt({ bundle, question, fieldLabel, fieldMeta }) {
  const fieldContext = fieldMeta
    ? [
        fieldMeta.label ? `Field label: ${fieldMeta.label}` : null,
        fieldMeta.name ? `Field name: ${fieldMeta.name}` : null,
        fieldMeta.placeholder ? `Placeholder: ${fieldMeta.placeholder}` : null,
        fieldMeta.inputType ? `Input type: ${fieldMeta.inputType}` : null,
        Array.isArray(fieldMeta.options) && fieldMeta.options.length > 0
          ? `Options: ${fieldMeta.options.map(option => `${option.text} (${option.value})`).join(', ')}`
          : null,
      ].filter(Boolean).join('\n')
    : '';

  return [
    'You are helping Jainam Shah answer a live job application form.',
    'Use only the supplied repository context and the selected job report.',
    'Write an answer that is accurate, specific, and ready to paste into the application form.',
    'Prefer concise answers unless the question explicitly asks for detail.',
    'Do not invent experience or credentials. If something is uncertain, make a careful best-effort answer grounded in the provided material.',
    fieldLabel ? `Target field: ${fieldLabel}` : null,
    fieldContext ? `\nField metadata:\n${fieldContext}` : null,
    `\nUser question:\n${question}`,
    `\nRepository context:\n${bundle.combinedContext || 'No context available.'}`,
    '\nReturn plain text only. No markdown fences, no bullet-heavy preamble, no analysis.',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// GET /api/postings — All postings with URLs hydrated from reports
// ---------------------------------------------------------------------------

app.get('/api/postings', async (req, res) => {
  try {
    const applicationsPath = path.join(CAREER_OPS_PATH, 'data/applications.md');
    const content = await fs.readFile(applicationsPath, 'utf-8');
    const postings = parseApplicationsTable(content);

    // Hydrate URLs from reports
    for (const posting of postings) {
      if (!posting.reportLink) continue;
      try {
        const reportPath = path.join(CAREER_OPS_PATH, posting.reportLink);
        const reportContent = await fs.readFile(reportPath, 'utf-8');
        const report = parseReport(reportContent);
        posting.url = report.header?.url || '';
      } catch {
        // Report file missing — skip
      }
    }

    res.json({
      success: true,
      postings,
      count: postings.length,
      lastSync: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Daemon] Error reading postings:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/report-raw/:filename — Raw markdown of a specific report
// ---------------------------------------------------------------------------

app.get('/api/report-raw/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    // Sanitize: only allow alphanumeric, hyphens, and dots
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const ext = safe.endsWith('.md') ? '' : '.md';
    const reportPath = path.join(CAREER_OPS_PATH, 'reports', `${safe}${ext}`);

    const content = await fs.readFile(reportPath, 'utf-8');
    const parsed = parseReport(content);

    res.json({
      success: true,
      raw: content,
      parsed,
      filename: safe,
    });
  } catch (error) {
    res.status(404).json({ success: false, error: `Report not found: ${error.message}` });
  }
});

// ---------------------------------------------------------------------------
// GET /api/report/:reportId — Structured report by ID
// ---------------------------------------------------------------------------

app.get('/api/report/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const reportsDir = path.join(CAREER_OPS_PATH, 'reports');
    const files = await fs.readdir(reportsDir);

    // Find report file starting with the ID
    const match = files.find(f => f.startsWith(`${reportId}-`) && f.endsWith('.md'));
    if (!match) {
      return res.status(404).json({ success: false, error: `No report starting with ${reportId}` });
    }

    const content = await fs.readFile(path.join(reportsDir, match), 'utf-8');
    const report = parseReport(content);

    res.json({ success: true, report, filename: match });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/cv — CV markdown
// ---------------------------------------------------------------------------

app.get('/api/cv', async (req, res) => {
  try {
    const cvPath = path.join(CAREER_OPS_PATH, 'cv.md');
    const content = await fs.readFile(cvPath, 'utf-8');
    res.json({ success: true, cv: content });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/profile — Profile YAML (parsed)
// ---------------------------------------------------------------------------

app.get('/api/profile', async (req, res) => {
  try {
    const profilePath = path.join(CAREER_OPS_PATH, 'config/profile.yml');
    const content = await fs.readFile(profilePath, 'utf-8');
    const parsed = parseProfile(content);
    res.json({ success: true, raw: content, profile: parsed });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/context — Workspace context bundle for a specific posting/report
// ---------------------------------------------------------------------------

app.get('/api/context', async (req, res) => {
  try {
    const { reportFilename } = req.query;
    const bundle = await buildContextBundle({ reportFilename });

    res.json({
      success: true,
      reportFilename: reportFilename || null,
      files: bundle.files.map(file => ({
        path: file.path,
        label: file.label,
        content: file.content,
      })),
      combinedContext: bundle.combinedContext,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/output-pdfs — List available CV PDFs
// ---------------------------------------------------------------------------

app.get('/api/output-pdfs', async (req, res) => {
  try {
    const outputDir = path.join(CAREER_OPS_PATH, 'output');
    const files = await fs.readdir(outputDir);
    const pdfs = files
      .filter(f => f.endsWith('.pdf'))
      .map(f => ({
        filename: f,
        path: path.join(outputDir, f),
        sizeBytes: fsSync.statSync(path.join(outputDir, f)).size,
      }));

    res.json({ success: true, pdfs, count: pdfs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/output-pdf/:filename — Serve a specific PDF as base64
// ---------------------------------------------------------------------------

app.get('/api/output-pdf/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const pdfPath = path.join(CAREER_OPS_PATH, 'output', safe);

    const buffer = await fs.readFile(pdfPath);
    const base64 = buffer.toString('base64');

    res.json({
      success: true,
      filename: safe,
      base64,
      mimeType: 'application/pdf',
      sizeBytes: buffer.length,
    });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/output-pdf-raw/:filename — Serve raw PDF for drag-and-drop
// ---------------------------------------------------------------------------

app.get('/api/output-pdf-raw/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const pdfPath = path.join(CAREER_OPS_PATH, 'output', safe);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    res.sendFile(pdfPath);
  } catch (error) {
    res.status(404).send('Not found');
  }
});

// ---------------------------------------------------------------------------
// GET /api/ollama/models — List locally available Ollama models
// ---------------------------------------------------------------------------

app.get('/api/ollama/models', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const json = await response.json();
    const models = (json.models || []).map(model => ({
      name: model.name,
      size: model.size,
      modifiedAt: model.modified_at,
      digest: model.digest,
    }));

    res.json({ success: true, models, count: models.length });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: `Could not reach Ollama at ${OLLAMA_URL}: ${error.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ollama/generate — Generate an answer using repo + JD context
// ---------------------------------------------------------------------------

app.post('/api/ollama/generate', async (req, res) => {
  try {
    const { model, question, reportFilename, fieldLabel, fieldMeta } = req.body || {};

    if (!model) {
      return res.status(400).json({ success: false, error: 'Missing "model" in body' });
    }

    if (!question || !String(question).trim()) {
      return res.status(400).json({ success: false, error: 'Missing "question" in body' });
    }

    const bundle = await buildContextBundle({ reportFilename });
    const prompt = buildOllamaPrompt({
      bundle,
      question: String(question).trim(),
      fieldLabel,
      fieldMeta,
    });

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const json = await response.json();
    res.json({
      success: true,
      answer: (json.response || '').trim(),
      model,
      contextFiles: bundle.files.map(file => file.path),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: `Ollama generation failed: ${error.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/status/:num — Update application status
// ---------------------------------------------------------------------------

app.patch('/api/status/:num', async (req, res) => {
  try {
    const num = parseInt(req.params.num, 10);
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Missing "status" in body' });
    }

    const canonicalStates = [
      'Evaluated', 'Applied', 'Responded', 'Interview',
      'Offer', 'Rejected', 'Discarded', 'SKIP',
    ];

    if (!canonicalStates.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status "${status}". Must be one of: ${canonicalStates.join(', ')}`,
      });
    }

    const applicationsPath = path.join(CAREER_OPS_PATH, 'data/applications.md');
    const result = updateApplicationStatus(applicationsPath, num, status);

    if (!result.success) {
      return res.status(404).json(result);
    }

    console.log(`[Daemon] Status updated: #${num} → ${status}`);
    res.json(result);
  } catch (error) {
    console.error('[Daemon] Error updating status:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sync — Full data sync (postings + reports + cv + profile)
// ---------------------------------------------------------------------------

app.get('/api/sync', async (req, res) => {
  try {
    // Read applications
    const applicationsPath = path.join(CAREER_OPS_PATH, 'data/applications.md');
    const applicationsContent = await fs.readFile(applicationsPath, 'utf-8');
    const postings = parseApplicationsTable(applicationsContent);

    // Read reports and hydrate URLs
    const reports = {};
    for (const posting of postings) {
      if (!posting.reportLink) continue;
      try {
        const reportPath = path.join(CAREER_OPS_PATH, posting.reportLink);
        const reportContent = await fs.readFile(reportPath, 'utf-8');
        const report = parseReport(reportContent);
        reports[posting.id] = report;
        posting.url = report.header?.url || '';
      } catch {
        // Report file missing — skip
      }
    }

    // Read user data
    let cv = '';
    let profileRaw = '';
    let profile = {};

    try {
      cv = await fs.readFile(path.join(CAREER_OPS_PATH, 'cv.md'), 'utf-8');
    } catch { /* cv.md not found */ }

    try {
      profileRaw = await fs.readFile(path.join(CAREER_OPS_PATH, 'config/profile.yml'), 'utf-8');
      profile = parseProfile(profileRaw);
    } catch { /* profile.yml not found */ }

    const contextBundle = await buildContextBundle();

    // List available PDFs
    let pdfs = [];
    try {
      const outputDir = path.join(CAREER_OPS_PATH, 'output');
      const files = await fs.readdir(outputDir);
      pdfs = files.filter(f => f.endsWith('.pdf'));
    } catch { /* output dir not found */ }

    res.json({
      success: true,
      data: {
        postings,
        reports,
        cv,
        profile,
        profileRaw,
        pdfs,
        contextFiles: contextBundle.files.map(file => ({
          path: file.path,
          label: file.label,
        })),
      },
      count: {
        postings: postings.length,
        reports: Object.keys(reports).length,
        pdfs: pdfs.length,
      },
      lastSync: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Daemon] Error syncing data:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings — Read or update the local career-ops root path
// ---------------------------------------------------------------------------

app.get('/api/settings', (req, res) => {
  res.json({
    success: true,
    rootPath: CAREER_OPS_PATH,
  });
});

app.post('/api/settings', (req, res) => {
  try {
    const { rootPath } = req.body || {};
    if (!rootPath || !String(rootPath).trim()) {
      return res.status(400).json({ success: false, error: 'Missing "rootPath" in body' });
    }

    const resolved = path.resolve(String(rootPath));
    if (!fsSync.existsSync(resolved) || !fsSync.statSync(resolved).isDirectory()) {
      return res.status(400).json({
        success: false,
        error: `Path does not exist or is not a directory: ${resolved}`,
      });
    }

    const applicationsPath = path.join(resolved, 'data', 'applications.md');
    if (!fsSync.existsSync(applicationsPath)) {
      return res.status(400).json({
        success: false,
        error: `Directory does not appear to contain a career-ops workspace (missing data/applications.md): ${resolved}`,
      });
    }

    CAREER_OPS_PATH = resolved;
    console.log(`[Daemon] Career-Ops root updated to: ${CAREER_OPS_PATH}`);

    res.json({
      success: true,
      rootPath: CAREER_OPS_PATH,
      message: 'Career-Ops root directory updated successfully.',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    careerOpsPath: CAREER_OPS_PATH,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[Daemon] Server running on http://localhost:${PORT}`);
  console.log(`[Daemon] API endpoints:`);
  console.log(`  GET    /api/postings              - All postings`);
  console.log(`  GET    /api/report/:id             - Parsed report by ID`);
  console.log(`  GET    /api/report-raw/:filename   - Raw report markdown`);
  console.log(`  GET    /api/cv                     - CV markdown`);
  console.log(`  GET    /api/profile                - Profile YAML`);
  console.log(`  GET    /api/context                - Workspace context bundle`);
  console.log(`  GET    /api/output-pdfs            - List available PDFs`);
  console.log(`  GET    /api/output-pdf/:filename   - Serve PDF as base64`);
  console.log(`  GET    /api/ollama/models          - List Ollama models`);
  console.log(`  POST   /api/ollama/generate        - Generate answer with Ollama`);
  console.log(`  PATCH  /api/status/:num            - Update application status`);
  console.log(`  GET    /api/sync                   - Full data sync`);
  console.log(`  GET    /health                     - Health check`);
});

process.on('SIGINT', () => {
  console.log('\n[Daemon] Shutting down...');
  process.exit(0);
});
