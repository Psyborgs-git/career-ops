/**
 * Form Filler
 * 
 * Generates AI-powered answers for form fields
 * Combines report data, user CV, and contextual information
 */

import { extractReportContext } from './dataParser.js';

/**
 * Generate answers for all form fields
 */
export async function generateAnswers(fields, report, userData) {
  const reportContext = extractReportContext(report);
  const answers = {};

  for (const field of fields) {
    try {
      const answer = await generateFieldAnswer(field, reportContext, userData, report);
      answers[field.id] = answer;
    } catch (error) {
      console.error(`Failed to generate answer for ${field.id}:`, error);
      answers[field.id] = {
        value: '',
        source: 'error',
        error: error.message
      };
    }
  }

  return answers;
}

/**
 * Generate answer for a single field
 */
async function generateFieldAnswer(field, reportContext, userData, report) {
  const { source, sourceData } = field;

  // Handle different field sources
  if (source?.startsWith('user:')) {
    return generateUserFieldAnswer(source, userData);
  }

  if (source?.startsWith('report:')) {
    return generateReportFieldAnswer(source, reportContext, report);
  }

  if (source === 'auto:cv_upload') {
    return { value: 'auto-generate', source: 'auto:cv_upload' };
  }

  // Default: no mapping found
  return {
    value: '',
    source: 'unmapped',
    confidence: 'low'
  };
}

/**
 * Generate user field answers (name, email, phone, etc.)
 */
function generateUserFieldAnswer(source, userData) {
  // Parse user data (from cv.md and profile.yml)
  const parsedCv = parseCV(userData.cv);
  const parsedProfile = parseProfile(userData.profile);

  const answers = {
    'user:name': parsedProfile.fullName || parsedCv.name || '',
    'user:email': parsedProfile.email || '',
    'user:phone': parsedProfile.phone || '',
    'user:linkedin': parsedProfile.linkedinUrl || '',
    'user:location': parsedProfile.location || '',
    'user:website': parsedProfile.portfolioUrl || ''
  };

  return {
    value: answers[source] || '',
    source,
    confidence: answers[source] ? 'high' : 'medium'
  };
}

/**
 * Generate report field answers (why join, technical match, etc.)
 */
function generateReportFieldAnswer(source, reportContext, report) {
  const answers = {
    'report:cultural_fit': {
      value: extractWhyJoinAnswer(reportContext, report),
      source,
      confidence: 'high'
    },
    'report:technical_match': {
      value: extractTechnicalAnswer(reportContext, report),
      source,
      confidence: 'high'
    },
    'report:compensation': {
      value: extractSalaryAnswer(reportContext),
      source,
      confidence: 'high'
    }
  };

  return answers[source] || {
    value: '',
    source,
    confidence: 'low'
  };
}

/**
 * Extract "Why join this company?" answer from report
 */
function extractWhyJoinAnswer(context, report) {
  // Use report Section E (cultural fit) + Section D (company signals)
  const culturalFit = report?.e_cultural || '';
  const companySignals = report?.d_signals || '';

  // Create a compelling narrative combining both
  let answer = '';

  if (culturalFit) {
    // Extract first 2-3 sentences from cultural fit section
    const sentences = culturalFit.split(/[.!?]+/).slice(0, 3).join('. ');
    answer += sentences + '. ';
  }

  if (companySignals) {
    // Add company context
    const signals = companySignals.split(/[.!?]+/).slice(0, 2).join('. ');
    answer += 'What excites me about ' + (context.company || 'your company') + ': ' + signals;
  }

  return answer.trim() || 'I am excited about this opportunity to contribute to your team.';
}

/**
 * Extract technical background answer
 */
function extractTechnicalAnswer(context, report) {
  // Use report Section B (technical match)
  const technicalMatch = report?.b_match || '';

  // Extract relevant experience bullets and synthesize
  const bullets = technicalMatch
    .split('\n')
    .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•'))
    .slice(0, 5)
    .map(line => line.replace(/^[-•]\s*/, '').trim());

  let answer = 'My background includes: ' + bullets.join('; ') + '.';

  return answer.trim() || 'I have relevant experience in the technologies and practices required for this role.';
}

/**
 * Extract salary expectations answer
 */
function extractSalaryAnswer(context) {
  const range = context.compensationRange;

  if (!range) {
    return 'Open to discussion based on role responsibilities and market rate.';
  }

  // Format as range with rationale
  return `${range.min.toLocaleString()}-${range.max.toLocaleString()} based on market research and my experience level.`;
}

/**
 * Parse CV markdown to extract key information
 */
function parseCV(cvMarkdown) {
  if (!cvMarkdown) return {};

  const lines = cvMarkdown.split('\n');
  const parsed = {};

  // Extract name (first line usually)
  const nameMatch = cvMarkdown.match(/^#\s+(.*?)\n/);
  parsed.name = nameMatch ? nameMatch[1].trim() : '';

  // Extract email
  const emailMatch = cvMarkdown.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
  parsed.email = emailMatch ? emailMatch[1] : '';

  // Extract phone
  const phoneMatch = cvMarkdown.match(/(\+?[\d\s\-\(\)]{10,})/);
  parsed.phone = phoneMatch ? phoneMatch[1].trim() : '';

  return parsed;
}

/**
 * Parse profile YAML to extract personal info
 */
function parseProfile(profileYaml) {
  if (!profileYaml) return {};

  const parsed = {};

  // Extract YAML key-value pairs
  const lines = profileYaml.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const key = match[1].toLowerCase();
      const value = match[2].trim().replace(/^["']|["']$/g, '');

      if (key === 'name' || key === 'full_name') parsed.fullName = value;
      if (key === 'email') parsed.email = value;
      if (key === 'phone') parsed.phone = value;
      if (key === 'location') parsed.location = value;
      if (key === 'linkedin') parsed.linkedinUrl = value;
      if (key === 'portfolio' || key === 'website') parsed.portfolioUrl = value;
    }
  }

  return parsed;
}
