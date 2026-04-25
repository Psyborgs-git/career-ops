/**
 * Data Parser
 * 
 * Reads career-ops data via localhost daemon
 * Daemon runs on http://localhost:3737 and serves files
 */

const DAEMON_URL = 'http://localhost:3737';

/**
 * Load all career-ops data from daemon
 */
export async function loadCareerOpsData() {
  try {
    console.log('[DataParser] Fetching from daemon:', DAEMON_URL);
    
    const response = await fetch(`${DAEMON_URL}/api/sync`);
    
    if (!response.ok) {
      throw new Error(`Daemon error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Sync failed');
    }

    console.log(`[DataParser] Loaded ${result.count.postings} postings, ${result.count.reports} reports`);

    return {
      postings: result.data.postings,
      reports: result.data.reports,
      userData: {
        cv: result.data.cv,
        profile: result.data.profile
      },
      lastSync: result.lastSync
    };
  } catch (error) {
    console.error('[DataParser] Failed to load career-ops data:', error);
    throw new Error(
      `Failed to load data. Is the daemon running? Start with: npm run daemon\n${error.message}`
    );
  }
}

/**
 * Parse applications.md markdown table into structured postings
 * 
 * Expected format:
 * | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
 * |---|------|---------|------|-------|--------|-----|--------|-------|
 * | 1 | 2024-04-20 | Anthropic | Engineer | 4.6/5 | Evaluated | ✅ | [001](reports/001-anthropic-2024-04-20.md) | Great match |
 */
export function parseApplicationsTable(markdown) {
  const lines = markdown.split('\n');
  const postings = [];
  let id = 0;

  // Skip header and separator rows
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line.startsWith('|') || line.includes('---')) continue;

    // Parse table row
    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
    
    if (cells.length < 9) continue;

    const [num, date, company, role, score, status, pdf, reportLink, notes] = cells;

    // Extract report markdown link: [001](reports/001-anthropic-2024-04-20.md)
    const linkMatch = reportLink.match(/\[(.*?)\]\((.*?)\)/);
    const reportPath = linkMatch ? linkMatch[2] : '';

    postings.push({
      id: `${num}-${company.toLowerCase().replace(/\s+/g, '-')}`,
      number: parseInt(num),
      date,
      company,
      role,
      score: parseFloat(score),
      status,
      hasPdf: pdf === '✅',
      reportLink: reportPath,
      notes
    });
  }

  return postings;
}

/**
 * Parse report markdown file into structured object
 * 
 * Expected format:
 * # {Number} | {Company} — {Role} | {Location}
 * **Score:** X.X/5
 * **URL:** [link](url)
 * 
 * ## A. Role Summary
 * [content]
 * 
 * ## B. Technical Match
 * [content]
 * ... etc
 */
export function parseReport(markdown) {
  const sections = {
    header: {},
    a_summary: '',
    b_match: '',
    c_compensation: '',
    d_signals: '',
    e_cultural: '',
    f_next_steps: '',
    g_legitimacy: ''
  };

  // Extract header
  const headerMatch = markdown.match(/# ([\d]+)\s*\|\s*(.*?)\s*\n.*?\*\*Score:\s*([\d.]+)\/5/);
  if (headerMatch) {
    sections.header = {
      number: parseInt(headerMatch[1]),
      title: headerMatch[2],
      score: parseFloat(headerMatch[3])
    };
  }

  // Extract URL
  const urlMatch = markdown.match(/\*\*URL:\*\*\s*\[(.*?)\]\((.*?)\)/);
  if (urlMatch) {
    sections.header.url = urlMatch[2];
  }

  // Extract sections
  const sectionRegex = /##\s+([A-G])\.\s+(.*?)\n([\s\S]*?)(?=##\s+[A-G]\.|$)/g;
  let match;

  while ((match = sectionRegex.exec(markdown)) !== null) {
    const letter = match[1].toLowerCase();
    const title = match[2];
    const content = match[3].trim();

    sections[`${letter}_${title.toLowerCase().replace(/\s+/g, '_')}`] = content;
  }

  return sections;
}

/**
 * Extract key details from parsed report for form field matching
 */
export function extractReportContext(report) {
  return {
    score: report.header.score,
    url: report.header.url,
    company: report.header.title.split('—')[0]?.trim(),
    role: report.header.title.split('—')[1]?.trim(),
    whyJoin: report.e_cultural, // Culture fit narrative for "why join" questions
    technicalMatch: report.b_match, // For "describe your experience" questions
    compensationRange: extractCompRange(report.c_compensation), // For salary expectations
    nextSteps: report.f_next_steps // Interview prep and action plan
  };
}

/**
 * Extract salary range from compensation section
 */
function extractCompRange(compensation) {
  const match = compensation.match(/\$?([\d,]+)\s*-\s*\$?([\d,]+)/);
  if (match) {
    return {
      min: parseInt(match[1].replace(/,/g, '')),
      max: parseInt(match[2].replace(/,/g, ''))
    };
  }
  return null;
}
