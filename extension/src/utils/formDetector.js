/**
 * Form Detector
 * 
 * Detects form fields across different ATS platforms
 * Maps form fields to career-ops report data
 */

/**
 * Detect form type (ATS platform) based on page content and URL
 */
export function detectAtsType(url, pageHtml) {
  if (url.includes('greenhouse.io')) return 'greenhouse';
  if (url.includes('ashbyhq.com')) return 'ashby';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('linkedin.com')) return 'linkedin';
  
  // Detect by page HTML patterns
  if (pageHtml?.includes('greenhouse-form')) return 'greenhouse';
  if (pageHtml?.includes('ashby') || pageHtml?.includes('job-form')) return 'ashby';
  if (pageHtml?.includes('lever-form')) return 'lever';
  
  return 'custom'; // Generic form
}

/**
 * Map form fields to report data sources
 * 
 * Rules:
 * - name, email, phone → from cv.md + profile.yml
 * - why join / cover letter → from report section E (cultural fit)
 * - technical background / experience → from report section B (technical match)
 * - salary expectations → from report section C (compensation)
 * - custom fields → context-aware from relevant sections
 */
export function detectFormFields(fields, posting, report) {
  const mapped = [];

  for (const field of fields) {
    const fieldMapping = mapField(field, posting, report);
    mapped.push(fieldMapping);
  }

  return mapped;
}

/**
 * Map a single form field to its data source
 */
function mapField(field, posting, report) {
  const lowerLabel = field.label?.toLowerCase() || '';
  const lowerName = field.name?.toLowerCase() || '';

  // Combine label and name for better matching
  const fieldContext = `${lowerLabel} ${lowerName}`;

  let source = null;
  let sourceData = null;

  // Personal info fields
  if (fieldContext.includes('name') && !fieldContext.includes('company')) {
    source = 'user:name';
  }
  if (fieldContext.includes('email')) {
    source = 'user:email';
  }
  if (fieldContext.includes('phone')) {
    source = 'user:phone';
  }
  if (fieldContext.includes('linkedin')) {
    source = 'user:linkedin';
  }

  // Cover letter / Why join fields
  if (
    fieldContext.includes('cover letter') ||
    fieldContext.includes('why') ||
    fieldContext.includes('interested') ||
    fieldContext.includes('motivation') ||
    fieldContext.includes('tell us about') ||
    fieldContext.includes('describe yourself')
  ) {
    source = 'report:cultural_fit';
    sourceData = report?.e_cultural || report?.e_cultural_fit || '';
  }

  // Technical background / Experience
  if (
    fieldContext.includes('experience') ||
    fieldContext.includes('background') ||
    fieldContext.includes('technical') ||
    fieldContext.includes('skills') ||
    fieldContext.includes('qualifications')
  ) {
    source = 'report:technical_match';
    sourceData = report?.b_match || report?.b_technical_match || '';
  }

  // Salary expectations
  if (
    fieldContext.includes('salary') ||
    fieldContext.includes('compensation') ||
    fieldContext.includes('expected') ||
    fieldContext.includes('range')
  ) {
    source = 'report:compensation';
    sourceData = report?.c_compensation || '';
  }

  // CV / Resume upload
  if (
    fieldContext.includes('resume') ||
    fieldContext.includes('cv') ||
    fieldContext.includes('upload') ||
    field.type === 'file'
  ) {
    source = 'auto:cv_upload';
  }

  return {
    ...field,
    source,
    sourceData,
    confidence: source ? 'high' : 'low' // Will be medium/low if heuristic match is weak
  };
}

/**
 * Validate form fields (e.g., detect multi-page forms, hidden fields, etc.)
 */
export function validateFormFields(fields) {
  return {
    totalFields: fields.length,
    visibleFields: fields.filter(f => f.visible !== false).length,
    requiredFields: fields.filter(f => f.required).length,
    fileFields: fields.filter(f => f.type === 'file').length,
    textareas: fields.filter(f => f.type === 'textarea').length,
    selects: fields.filter(f => f.type === 'select').length,
    hasEmailField: fields.some(f => f.label?.toLowerCase().includes('email')),
    hasCvField: fields.some(f => 
      f.type === 'file' && (f.label?.toLowerCase().includes('cv') || f.label?.toLowerCase().includes('resume'))
    )
  };
}

/**
 * Get ATS-specific field mappings
 * Different ATSs use different field patterns
 */
export function getAtsFieldPatterns(atsType) {
  const patterns = {
    greenhouse: {
      nameField: 'input[name*="first_name"], input[name*="full_name"]',
      emailField: 'input[type="email"]',
      phoneField: 'input[name*="phone"]',
      cvField: 'input[type="file"][name*="resume"]',
      coverLetterField: 'textarea[name*="cover"], textarea[name*="letter"]'
    },
    ashby: {
      nameField: 'input[placeholder*="Name"]',
      emailField: 'input[type="email"]',
      phoneField: 'input[placeholder*="Phone"]',
      cvField: 'input[type="file"]',
      coverLetterField: 'textarea, .rich-text-editor'
    },
    lever: {
      nameField: 'input[name*="name"]',
      emailField: 'input[type="email"]',
      phoneField: 'input[type="tel"]',
      cvField: 'input[type="file"]',
      coverLetterField: 'textarea[name*="cover"], textarea'
    },
    linkedin: {
      nameField: 'input[aria-label*="name"]',
      emailField: 'input[aria-label*="email"]',
      phoneField: 'input[aria-label*="phone"]',
      cvField: 'input[aria-label*="resume"]',
      coverLetterField: 'textarea[aria-label*="cover"], textarea'
    },
    custom: {
      nameField: 'input[name*="name"], input[placeholder*="name"]',
      emailField: 'input[type="email"]',
      phoneField: 'input[type="tel"], input[name*="phone"]',
      cvField: 'input[type="file"]',
      coverLetterField: 'textarea'
    }
  };

  return patterns[atsType] || patterns.custom;
}
