/**
 * File Reader — Career-Ops Extension Daemon
 *
 * Shared parsing logic for career-ops markdown/yaml files.
 * Used by daemon/server.js
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// applications.md parser
// ---------------------------------------------------------------------------

/**
 * Parse applications.md table into postings array.
 *
 * Expected format:
 * | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
 * |---|------|---------|------|-------|--------|-----|--------|-------|
 * | 285 | 2026-04-22 | Decagon | EM Agents London | 4.6/5 | Evaluated | ❌ | [285](...) | notes |
 */
function parseApplicationsTable(markdown) {
  const lines = markdown.split('\n');
  const postings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.startsWith('|') || line.includes('---')) continue;

    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
    if (cells.length < 9) continue;

    const [num, date, company, role, score, status, pdf, reportLink, ...rest] = cells;
    const numericId = parseInt(num, 10);
    if (Number.isNaN(numericId)) continue;

    // Extract report markdown link: [285](reports/285-decagon-…-2026-04-22.md)
    const linkMatch = reportLink.match(/\[(.*?)\]\((.*?)\)/);
    const reportPath = linkMatch ? linkMatch[2] : '';

    // Extract report filename from path (e.g. "285-decagon-em-agents-london-2026-04-22")
    const reportFilename = reportPath
      ? path.basename(reportPath, '.md')
      : '';

    const notes = rest.join(' | ').trim();

    postings.push({
      id: `${numericId}`,
      number: numericId,
      date,
      company,
      role,
      score: parseFloat(score) || 0,
      status,
      hasPdf: pdf.includes('✅'),
      reportLink: reportPath,
      reportFilename,
      url: '',   // hydrated later from report
      notes,
      priority: notes.includes('⭐⭐') ? 2 : notes.includes('⭐') ? 1 : notes.includes('🔥') ? 3 : 0,
    });
  }

  return postings;
}

// ---------------------------------------------------------------------------
// Report parser (robust — handles all observed report formats)
// ---------------------------------------------------------------------------

/**
 * Parse a career-ops report markdown file.
 *
 * Handles two main formats:
 *   Format A (detailed):
 *     # Company — Role (Location)
 *     **Score: 4.6/5 ⭐⭐**
 *     **URL:** https://…
 *     **PDF:** ❌
 *     **Legitimacy:** Tier 1 — …
 *     ---
 *     ## Block A — CV Match / ## Role Summary
 *
 *   Format B (compact batch):
 *     # Company — Role
 *     **Score:** 3.3/5
 *     **URL:** https://…
 */
function parseReport(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return { header: {}, sections: {}, raw: '' };
  }

  const result = {
    header: {},
    sections: {},
    raw: markdown,
  };

  // ---- Header line: # Company — Role ----
  const titleMatch = markdown.match(/^#\s+(.+)/m);
  if (titleMatch) {
    const titleLine = titleMatch[1].trim();
    // Split on " — " (em-dash) or " - " (hyphen)
    const parts = titleLine.split(/\s*[—–-]\s*/);
    if (parts.length >= 2) {
      result.header.company = parts[0].trim();
      result.header.role = parts.slice(1).join(' — ').trim();
    } else {
      result.header.title = titleLine;
    }
  }

  // ---- Score ----
  // Matches: **Score: 4.6/5 ⭐⭐** or **Score:** 3.3/5
  const scoreMatch = markdown.match(/\*\*Score:?\*?\*?\s*:?\s*([\d.]+)\/5/);
  if (scoreMatch) {
    result.header.score = parseFloat(scoreMatch[1]);
  }

  // ---- URL ----
  // Matches: **URL:** https://… or **URL:** [text](url)
  const urlMatch = markdown.match(/\*\*URL:\*\*\s*(?:\[.*?\]\((.*?)\)|(https?:\/\/\S+))/);
  if (urlMatch) {
    result.header.url = (urlMatch[1] || urlMatch[2] || '').trim();
  }

  // ---- PDF status ----
  const pdfMatch = markdown.match(/\*\*PDF:\*\*\s*([✅❌])/);
  if (pdfMatch) {
    result.header.hasPdf = pdfMatch[1] === '✅';
  }

  // ---- Legitimacy ----
  const legMatch = markdown.match(/\*\*Legitimacy:\*\*\s*(.+)/);
  if (legMatch) {
    result.header.legitimacy = legMatch[1].trim();
  }

  // ---- Report ID ----
  const idMatch = markdown.match(/\*\*Report ID:\*\*\s*#?(\d+)/);
  if (idMatch) {
    result.header.reportId = parseInt(idMatch[1], 10);
  }

  // ---- Sections ----
  // Split on ## headers and collect content
  const sectionRegex = /^##\s+(.+)$/gm;
  let match;
  const sectionStarts = [];

  while ((match = sectionRegex.exec(markdown)) !== null) {
    sectionStarts.push({
      title: match[1].trim(),
      index: match.index,
      end: 0,
    });
  }

  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i];
    const end = i + 1 < sectionStarts.length
      ? sectionStarts[i + 1].index
      : markdown.length;
    start.end = end;

    const rawTitle = start.title;
    const content = markdown.slice(
      start.index + rawTitle.length + 3, // skip "## " + title + newline
      end
    ).trim();

    // Normalize section key
    const key = normalizeSectionKey(rawTitle);
    result.sections[key] = content;

    // Also store the raw title for display
    if (!result.sections._titles) result.sections._titles = {};
    result.sections._titles[key] = rawTitle;
  }

  // ---- Extract positioning/application hook from Block F ----
  const blockF = result.sections.block_f || result.sections.positioning || '';
  const hookMatch = blockF.match(/\*\*Application hook:\*\*\s*"([^"]+)"/);
  if (hookMatch) {
    result.header.applicationHook = hookMatch[1];
  }

  // ---- Extract recommendation ----
  const recommendation = result.sections.recommendation || '';
  result.header.recommendation = recommendation
    .split('\n')
    .filter(l => l.trim().length > 0)
    .slice(0, 3)
    .join(' ')
    .replace(/\*\*/g, '')
    .trim();

  return result;
}

/**
 * Normalize a section title into a stable key.
 * "Block A — CV Match" → "block_a"
 * "Role Summary" → "role_summary"
 * "Block F — Positioning" → "block_f"
 * "Recommendation" → "recommendation"
 * "Global Score" → "global_score"
 */
function normalizeSectionKey(title) {
  // Check for "Block X" pattern
  const blockMatch = title.match(/^Block\s+([A-G])/i);
  if (blockMatch) {
    return `block_${blockMatch[1].toLowerCase()}`;
  }

  // Otherwise, slugify
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ---------------------------------------------------------------------------
// Profile YAML parser (lightweight — no external deps)
// ---------------------------------------------------------------------------

/**
 * Extract candidate info from config/profile.yml (basic YAML parsing).
 */
function parseProfile(yamlContent) {
  if (!yamlContent) return {};

  const result = {};
  const lines = yamlContent.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*([\w_]+):\s*"?([^"#]+)"?\s*$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();

    switch (key) {
      case 'full_name': result.fullName = value; break;
      case 'email': result.email = value; break;
      case 'phone': result.phone = value; break;
      case 'location': result.location = value; break;
      case 'linkedin': result.linkedin = value; break;
      case 'portfolio_url': result.portfolioUrl = value; break;
      case 'github': result.github = value; break;
      case 'target_range': result.targetRange = value; break;
      case 'visa_status': result.visa_status = value; break;
      case 'open_to_relocation': result.openToRelocation = value.toLowerCase() === 'true'; break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Status update (write-back to applications.md)
// ---------------------------------------------------------------------------

/**
 * Update the status of an application in data/applications.md.
 *
 * @param {string} applicationsPath — absolute path to applications.md
 * @param {number} postingNumber — the "#" column value
 * @param {string} newStatus — canonical status string (e.g. "Applied")
 * @returns {{ success: boolean, message: string }}
 */
function updateApplicationStatus(applicationsPath, postingNumber, newStatus) {
  const content = fs.readFileSync(applicationsPath, 'utf-8');
  const lines = content.split('\n');
  let updated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 9) continue;

    const num = parseInt(cells[0], 10);
    if (num !== postingNumber) continue;

    // Column order: # | Date | Company | Role | Score | Status | PDF | Report | Notes
    // Status is index 5 (0-based)
    cells[5] = newStatus;

    // Rebuild the line with pipes
    lines[i] = '| ' + cells.join(' | ') + ' |';
    updated = true;
    break;
  }

  if (!updated) {
    return { success: false, message: `Posting #${postingNumber} not found in tracker` };
  }

  fs.writeFileSync(applicationsPath, lines.join('\n'), 'utf-8');
  return { success: true, message: `Updated #${postingNumber} to "${newStatus}"` };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseApplicationsTable,
  parseReport,
  parseProfile,
  updateApplicationStatus,
};
