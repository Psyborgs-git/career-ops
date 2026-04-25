/**
 * CV Generator
 * 
 * Generates JD-optimized PDF using career-ops logic
 * Integrates generate-pdf.mjs approach for keyword optimization
 */

// Note: PDF generation will be implemented in Phase 5
// Options: html2pdf.js, Playwright backend, or chrome.offscreen API

/**
 * Generate JD-optimized CV for a posting
 */
export async function generateCV(posting, report, userData) {
  // Extract JD keywords from report
  const keywords = extractKeywords(report);

  // Parse CV from user data
  const cvData = parseCVData(userData.cv, userData.profile);

  // Generate optimized CV HTML
  const cvHtml = generateCVHtml(cvData, keywords, posting);

  // Convert HTML to PDF
  const pdfBlob = await htmlToPdf(cvHtml);

  return pdfBlob;
}

/**
 * Extract top 15-20 keywords from job description
 */
function extractKeywords(report) {
  // Extract from report sections A and B
  const jobDescription = (report?.a_summary || '') + '\n' + (report?.b_match || '');

  // Common tech keywords to look for
  const techKeywords = [
    'python', 'javascript', 'typescript', 'react', 'node', 'aws', 'gcp', 'docker',
    'kubernetes', 'sql', 'postgres', 'mongodb', 'api', 'rest', 'graphql', 'microservices',
    'agile', 'scrum', 'ci/cd', 'git', 'linux', 'terraform', 'machine learning', 'ai',
    'fastapi', 'django', 'flask', 'express', 'vue', 'angular', 'html', 'css'
  ];

  const foundKeywords = [];
  const lowerDesc = jobDescription.toLowerCase();

  for (const keyword of techKeywords) {
    if (lowerDesc.includes(keyword)) {
      foundKeywords.push(keyword);
    }
  }

  // Extract custom keywords (capitalized words, acronyms)
  const customMatches = jobDescription.match(/\b[A-Z]{2,}\b/g) || [];
  foundKeywords.push(...customMatches);

  // Return top 20, deduplicated
  return [...new Set(foundKeywords)].slice(0, 20);
}

/**
 * Parse CV markdown into structured data
 */
function parseCVData(cvMarkdown, profileYaml) {
  const data = {
    name: '',
    email: '',
    phone: '',
    location: '',
    summary: '',
    experience: [],
    projects: [],
    skills: [],
    education: []
  };

  if (!cvMarkdown) return data;

  const sections = cvMarkdown.split(/## /);

  for (const section of sections) {
    const lines = section.split('\n');
    const sectionTitle = lines[0]?.toLowerCase() || '';

    if (sectionTitle.includes('experience') || sectionTitle.includes('work')) {
      // Parse experience bullets
      const bullets = lines.filter(l => l.trim().startsWith('-'));
      data.experience = bullets.map(b => b.replace(/^-\s*/, '').trim());
    }

    if (sectionTitle.includes('project')) {
      // Parse projects
      const projects = lines.filter(l => l.trim().startsWith('-'));
      data.projects = projects.map(p => p.replace(/^-\s*/, '').trim());
    }

    if (sectionTitle.includes('skill')) {
      // Parse skills
      const skills = lines.filter(l => l.trim().length > 0 && !l.includes('##'));
      data.skills = skills;
    }

    if (sectionTitle.includes('education')) {
      // Parse education
      const edu = lines.filter(l => l.trim().startsWith('-'));
      data.education = edu.map(e => e.replace(/^-\s*/, '').trim());
    }

    if (sectionTitle.includes('summary') || sectionTitle.includes('about')) {
      // Parse summary
      data.summary = lines.slice(1).join('\n').trim();
    }
  }

  // Parse profile for personal info
  if (profileYaml) {
    const profileLines = profileYaml.split('\n');
    for (const line of profileLines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const key = match[1].toLowerCase();
        const value = match[2].trim().replace(/^["']|["']$/g, '');

        if (key === 'name' || key === 'full_name') data.name = value;
        if (key === 'email') data.email = value;
        if (key === 'phone') data.phone = value;
        if (key === 'location') data.location = value;
      }
    }
  }

  return data;
}

/**
 * Generate optimized CV HTML
 */
function generateCVHtml(cvData, keywords, posting) {
  // Reorder experience and projects by keyword relevance
  const optimizedExperience = rankByKeywordRelevance(cvData.experience, keywords);
  const optimizedProjects = rankByKeywordRelevance(cvData.projects, keywords);

  // Rewrite summary with keywords
  const optimizedSummary = injectKeywords(cvData.summary, keywords);

  // Build competency tags
  const competencies = extractCompetencies(keywords, cvData.skills);

  // Generate HTML (ATS-friendly, single column)
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: 'Calibri', Arial, sans-serif;
      line-height: 1.4;
      margin: 0.5in;
      color: #333;
      font-size: 11pt;
    }
    .header {
      text-align: center;
      margin-bottom: 10px;
    }
    .name {
      font-size: 14pt;
      font-weight: bold;
    }
    .contact {
      font-size: 10pt;
      margin-top: 3px;
    }
    .section {
      margin-top: 10px;
    }
    .section-title {
      font-weight: bold;
      font-size: 11pt;
      border-bottom: 1px solid #000;
      margin-bottom: 5px;
    }
    .competencies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 5px 0;
    }
    .tag {
      background: #f0f0f0;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 10pt;
    }
    .bullet {
      margin-left: 20px;
      text-indent: -20px;
      margin-bottom: 5px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="name">${cvData.name}</div>
    <div class="contact">
      ${cvData.email} | ${cvData.phone} | ${cvData.location}
    </div>
  </div>

  <div class="section">
    <div class="section-title">PROFESSIONAL SUMMARY</div>
    <p>${optimizedSummary}</p>
  </div>

  <div class="section">
    <div class="section-title">KEY COMPETENCIES</div>
    <div class="competencies">
      ${competencies.map(comp => `<span class="tag">${comp}</span>`).join('')}
    </div>
  </div>

  <div class="section">
    <div class="section-title">PROFESSIONAL EXPERIENCE</div>
    ${optimizedExperience.slice(0, 8).map(exp => `
      <div class="bullet">• ${exp}</div>
    `).join('')}
  </div>

  <div class="section">
    <div class="section-title">PROJECTS & ACHIEVEMENTS</div>
    ${optimizedProjects.slice(0, 5).map(proj => `
      <div class="bullet">• ${proj}</div>
    `).join('')}
  </div>

  ${cvData.education.length > 0 ? `
    <div class="section">
      <div class="section-title">EDUCATION</div>
      ${cvData.education.slice(0, 3).map(edu => `
        <div class="bullet">• ${edu}</div>
      `).join('')}
    </div>
  ` : ''}
</body>
</html>
  `;

  return html;
}

/**
 * Rank experience/project bullets by keyword relevance
 */
function rankByKeywordRelevance(items, keywords) {
  const scored = items.map(item => {
    let score = 0;
    const lowerItem = item.toLowerCase();
    for (const keyword of keywords) {
      if (lowerItem.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    return { item, score };
  });

  return scored.sort((a, b) => b.score - a.score).map(s => s.item);
}

/**
 * Inject keywords into summary text
 */
function injectKeywords(summary, keywords) {
  let injected = summary;

  // Find where to insert keywords (after first sentence)
  const sentences = injected.split(/[.!?]/);
  if (sentences.length > 1) {
    // Add keyword context to second sentence if missing
    const keywordPhrase = keywords.slice(0, 5).join(', ');
    if (!injected.toLowerCase().includes('proficient')) {
      sentences.splice(1, 0, `Proficient in ${keywordPhrase}.`);
    }
  }

  return sentences.join('. ').trim();
}

/**
 * Extract competency tags from keywords and skills
 */
function extractCompetencies(keywords, skills) {
  const competencies = new Set([...keywords.slice(0, 8), ...skills.slice(0, 5)]);
  return Array.from(competencies).slice(0, 12);
}

/**
 * Convert HTML to PDF (placeholder - needs implementation)
 * 
 * Options:
 * 1. Use html2pdf library (client-side, limited)
 * 2. Send to backend service (requires server)
 * 3. Use Puppeteer/Playwright (only in background script, complex)
 */
async function htmlToPdf(html) {
  // TODO: Implement PDF generation
  // For now, return a placeholder blob
  console.warn('[CVGenerator] PDF generation not yet implemented');
  
  const blob = new Blob([html], { type: 'text/html' });
  return blob;
}
