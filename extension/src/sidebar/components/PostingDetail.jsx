import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AnswerCard from './AnswerCard';
import OllamaTab from './OllamaTab';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'answers', label: 'Answers' },
  { key: 'cv', label: 'CV' },
  { key: 'apply', label: 'Apply' },
  { key: 'ai', label: 'AI' },
];

const CANONICAL_STATUSES = [
  'Evaluated', 'Applied', 'Responded', 'Interview',
  'Offer', 'Rejected', 'Discarded', 'SKIP',
];

function getScoreClass(score) {
  if (score >= 4.5) return 'score-hot';
  if (score >= 4.0) return 'score-high';
  if (score >= 3.5) return 'score-mid';
  return 'score-low';
}

export default function PostingDetail({
  posting,
  profile,
  cv,
  pdfs,
  contextFiles,
  onBack,
  onStatusUpdate,
}) {
  const [tab, setTab] = useState('overview');
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [statusValue, setStatusValue] = useState(posting.status);
  const [formFields, setFormFields] = useState([]);
  const [formMessage, setFormMessage] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [cvMessage, setCvMessage] = useState('');
  const [cvBusy, setCvBusy] = useState(false);

  useEffect(() => {
    if (!posting.reportFilename) return;

    setReportLoading(true);
    chrome.runtime.sendMessage(
      { type: 'GET_REPORT', payload: { reportFilename: posting.reportFilename } },
      (resp) => {
        if (resp?.success) {
          setReportData(resp.parsed);
        }
        setReportLoading(false);
      }
    );
  }, [posting.reportFilename]);

  const handleStatusChange = useCallback((event) => {
    const newStatus = event.target.value;
    setStatusValue(newStatus);
    onStatusUpdate(posting.number, newStatus);
  }, [posting.number, onStatusUpdate]);

  const matchingPdfs = useMemo(() => (pdfs || []).filter((fileName) => {
    const lower = String(fileName).toLowerCase();
    return lower.includes(posting.company.toLowerCase().replace(/\s+/g, '-')) ||
      lower.includes(`${posting.number}-`);
  }), [pdfs, posting.company, posting.number]);

  const answers = useMemo(
    () => buildAnswers(reportData, posting, profile),
    [reportData, posting, profile]
  );

  const detectForm = useCallback(async () => {
    setFormBusy(true);
    setFormMessage('');
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'DETECT_FORM' });
      if (!resp?.success) {
        throw new Error(resp?.error || 'Could not detect form fields');
      }

      setFormFields(resp.fields || []);
      setFormMessage(`Detected ${resp.count || 0} visible fields on the active page.`);
      return resp.fields || [];
    } catch (err) {
      setFormFields([]);
      setFormMessage(err.message);
      return [];
    } finally {
      setFormBusy(false);
    }
  }, []);

  const handleAutofill = useCallback(async () => {
    setFormBusy(true);
    setFormMessage('');
    try {
      const detectedFields = await chrome.runtime.sendMessage({ type: 'DETECT_FORM' });
      if (!detectedFields?.success) {
        throw new Error(detectedFields?.error || 'Could not inspect the current application page');
      }

      const fields = detectedFields.fields || [];
      setFormFields(fields);

      const autofillAnswers = buildAutofillAnswers({
        fields,
        profile,
        answers,
      });

      if (Object.keys(autofillAnswers).length === 0) {
        setFormMessage('I detected the form, but none of the fields matched the available profile/report data yet.');
        return;
      }

      const fillResp = await chrome.runtime.sendMessage({
        type: 'AUTOFILL_FORM',
        payload: { answers: autofillAnswers },
      });

      if (!fillResp?.success) {
        throw new Error(fillResp?.error || 'Autofill failed');
      }

      setFormMessage(`Filled ${fillResp.filledCount || 0} fields. Please review the page before submitting.`);
    } catch (err) {
      setFormMessage(err.message);
    } finally {
      setFormBusy(false);
    }
  }, [answers, profile]);

  const handleAutoAttach = useCallback(async (pdfFile) => {
    setCvBusy(true);
    setCvMessage('');
    try {
      const pdfResp = await chrome.runtime.sendMessage({
        type: 'GET_PDF',
        payload: { filename: pdfFile },
      });

      if (!pdfResp?.success || !pdfResp.base64) {
        throw new Error(pdfResp?.error || 'Could not load PDF data');
      }

      const attachResp = await chrome.runtime.sendMessage({
        type: 'ATTACH_FILE',
        payload: {
          base64Data: pdfResp.base64,
          filename: pdfFile,
          contentType: pdfResp.mimeType || 'application/pdf',
        },
      });

      if (!attachResp?.success) {
        throw new Error(attachResp?.error || 'Could not find a matching upload field on the page');
      }

      setCvMessage(`Attached ${pdfFile} to the active application page.`);
    } catch (err) {
      setCvMessage(err.message);
    } finally {
      setCvBusy(false);
    }
  }, []);

  return (
    <div className="detail-view">
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>← Back to list</button>
        <h2>{posting.company}</h2>
        <div className="role-text">{posting.role || '—'}</div>
        <div className="detail-meta">
          <span className={`score-badge ${getScoreClass(posting.score)}`}>
            {posting.score}/5
          </span>
          <select
            className="status-select"
            value={statusValue}
            onChange={handleStatusChange}
          >
            {CANONICAL_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <span className="date-tag">{posting.date}</span>
        </div>
      </div>

      <div className="tab-bar">
        {TABS.map((item) => (
          <button
            key={item.key}
            className={`tab-btn ${tab === item.key ? 'active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === 'overview' && (
          <OverviewTab posting={posting} report={reportData} loading={reportLoading} />
        )}

        {tab === 'answers' && (
          <AnswersTab answers={answers} />
        )}

        {tab === 'cv' && (
          <CVTab
            posting={posting}
            cv={cv}
            matchingPdfs={matchingPdfs}
            contextFiles={contextFiles}
            onAutoAttach={handleAutoAttach}
            busy={cvBusy}
            message={cvMessage}
          />
        )}

        {tab === 'apply' && (
          <ApplyTab
            posting={posting}
            profile={profile}
            answers={answers}
            formFields={formFields}
            formBusy={formBusy}
            formMessage={formMessage}
            onDetectForm={detectForm}
            onAutofill={handleAutofill}
          />
        )}

        {tab === 'ai' && (
          <OllamaTab
            posting={posting}
            reportFilename={posting.reportFilename}
            formFields={formFields}
            contextFiles={contextFiles}
            onDetectForm={detectForm}
          />
        )}
      </div>
    </div>
  );
}

function OverviewTab({ posting, report, loading }) {
  if (loading) {
    return <div className="loading-overlay"><div className="spinner" /><span>Loading report…</span></div>;
  }

  if (!report) {
    return (
      <div className="section-card">
        <h3>Report</h3>
        <p className="text-muted">No report available for this posting.</p>
      </div>
    );
  }

  const header = report.header || {};
  const sections = report.sections || {};

  return (
    <>
      <div className="section-card">
        <h3>Quick Info</h3>
        <ul>
          {header.company && <li><strong>Company:</strong> {header.company}</li>}
          {header.role && <li><strong>Role:</strong> {header.role}</li>}
          {header.url && <li><strong>Application URL:</strong> <a href={header.url} target="_blank" rel="noreferrer">Open job page</a></li>}
          {header.legitimacy && <li><strong>Legitimacy:</strong> {header.legitimacy}</li>}
          {header.applicationHook && <li><strong>Hook:</strong> “{header.applicationHook}”</li>}
          {header.recommendation && <li><strong>Recommendation:</strong> {header.recommendation}</li>}
          {posting.notes && <li><strong>Tracker notes:</strong> {posting.notes}</li>}
        </ul>
      </div>

      {Object.entries(sections)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, content]) => {
          const title = sections._titles?.[key] || key.replace(/_/g, ' ');
          return (
            <div className="section-card" key={key}>
              <h3>{title}</h3>
              <div className="report-content" dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }} />
            </div>
          );
        })}
    </>
  );
}

function AnswersTab({ answers }) {
  if (!answers || answers.length === 0) {
    return (
      <div className="section-card">
        <h3>Answers</h3>
        <p className="text-muted">No answers generated yet. Load the report first.</p>
      </div>
    );
  }

  return (
    <>
      <div className="text-sm text-muted" style={{ marginBottom: 12 }}>
        These are your prebuilt answers from the report and profile. Use them directly or feed them into the AI tab for a rewrite.
      </div>
      {answers.map((answer, index) => (
        <AnswerCard
          key={`${answer.label}-${index}`}
          label={answer.label}
          content={answer.content}
          source={answer.source}
        />
      ))}
    </>
  );
}

function CVTab({ posting, cv, matchingPdfs, contextFiles, onAutoAttach, busy, message }) {
  return (
    <>
      <div className="section-card">
        <h3>Resume upload helper</h3>
        <p className="text-sm text-muted">
          Open the application page, then either drag a CV card into the upload target or use one click to attach it automatically.
        </p>
        {message && <div className="inline-message mt-md">{message}</div>}

        {matchingPdfs.length > 0 ? matchingPdfs.map((pdf) => (
          <ResumeCard
            key={pdf}
            filename={pdf}
            onAutoAttach={onAutoAttach}
            busy={busy}
          />
        )) : (
          <p className="text-muted mt-md">
            No generated PDF matched this company yet. Run `node generate-pdf.mjs` if you want a tailored resume file.
          </p>
        )}
      </div>

      <div className="section-card">
        <h3>CV markdown reference</h3>
        {cv ? (
          <pre className="cv-preview-pane">{cv}</pre>
        ) : (
          <p className="text-muted">`cv.md` is not currently available in the extension cache.</p>
        )}
      </div>

      <div className="section-card">
        <h3>Context files available</h3>
        <div className="pill-list">
          {(contextFiles || []).map((file) => (
            <span key={file.path || file} className="info-pill">{file.label || file.path || file}</span>
          ))}
        </div>
        <p className="text-muted text-sm mt-sm">
          These are also used by the AI tab when drafting answers for this job.
        </p>
      </div>

      <div className="section-card">
        <h3>PDF status</h3>
        <p>{posting.hasPdf ? '✅ Tailored CV PDF already exists for this posting.' : '❌ No tailored PDF recorded for this posting yet.'}</p>
      </div>
    </>
  );
}

function ResumeCard({ filename, onAutoAttach, busy }) {
  const rawUrl = `http://localhost:3737/api/output-pdf-raw/${encodeURIComponent(filename)}`;

  const handleDragStart = useCallback((event) => {
    event.dataTransfer.setData('text/uri-list', rawUrl);
    event.dataTransfer.setData('text/plain', rawUrl);
    event.dataTransfer.effectAllowed = 'copy';
    try {
      event.dataTransfer.setData('DownloadURL', `application/pdf:${filename}:${rawUrl}`);
    } catch {
      // Some environments block DownloadURL — best effort only.
    }
  }, [filename, rawUrl]);

  return (
    <div className="resume-card">
      <div
        className="drag-card"
        draggable="true"
        onDragStart={handleDragStart}
        title="Drag this into a resume upload target"
      >
        <div className="pdf-icon">📄</div>
        <div>
          <div className="pdf-name">{filename}</div>
          <div className="field-meta">Drag this card to a file drop zone, or open/download it.</div>
        </div>
      </div>

      <div className="inline-controls mt-sm">
        <a className="btn btn-secondary" href={rawUrl} target="_blank" rel="noreferrer">Open PDF</a>
        <button className="btn btn-primary" onClick={() => onAutoAttach(filename)} disabled={busy}>
          {busy ? 'Attaching…' : '⚡ Attach to page'}
        </button>
      </div>
    </div>
  );
}

function ApplyTab({
  posting,
  profile,
  answers,
  formFields,
  formBusy,
  formMessage,
  onDetectForm,
  onAutofill,
}) {
  const handleOpenUrl = useCallback(() => {
    if (posting.url) {
      chrome.tabs.create({ url: posting.url, active: true });
    }
  }, [posting.url]);

  const handleCopyAll = useCallback(async () => {
    const content = (answers || [])
      .map((answer) => `${answer.label}\n${answer.content}`)
      .join('\n\n---\n\n');

    await navigator.clipboard.writeText(content);
  }, [answers]);

  return (
    <>
      <div className="section-card">
        <h3>Application page</h3>
        {posting.url ? (
          <div className="inline-controls">
            <button className="btn btn-primary" onClick={handleOpenUrl}>🔗 Open application page</button>
            <button className="btn btn-secondary" onClick={onDetectForm} disabled={formBusy}>🧭 Detect current form</button>
            <button className="btn btn-primary" onClick={onAutofill} disabled={formBusy}>✨ Detect + autofill</button>
          </div>
        ) : (
          <p className="text-muted">No application URL is attached to this report yet.</p>
        )}

        <p className="text-muted text-sm mt-sm">
          Autofill updates the active page only — nothing is submitted for you. You review, tweak, then click apply yourself.
        </p>

        {formMessage && <div className={`inline-message mt-md ${isErrorMessage(formMessage) ? 'error' : ''}`}>{formMessage}</div>}
      </div>

      <div className="section-card">
        <h3>Detected fields</h3>
        {formFields?.length ? (
          <div className="field-list compact">
            {formFields.map((field) => (
              <div className="field-card" key={field.id}>
                <div>
                  <div className="field-label">{field.label || field.name || field.id}</div>
                  <div className="field-meta">
                    {field.inputType || field.tagName}
                    {field.required ? ' · required' : ''}
                    {field.placeholder ? ` · ${field.placeholder}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">No fields detected yet. Open the application page and run detection first.</p>
        )}
      </div>

      <div className="section-card">
        <h3>Your info (manual fallback)</h3>
        <ul>
          <li><strong>Name:</strong> {profile?.fullName || '—'}</li>
          <li><strong>Email:</strong> {profile?.email || '—'}</li>
          <li><strong>Phone:</strong> {profile?.phone || '—'}</li>
          <li><strong>LinkedIn:</strong> {normalizeUrl(profile?.linkedin) || '—'}</li>
          <li><strong>Portfolio:</strong> {normalizeUrl(profile?.portfolioUrl) || '—'}</li>
          <li><strong>GitHub:</strong> {normalizeUrl(profile?.github) || '—'}</li>
          <li><strong>Location:</strong> {profile?.location || '—'}</li>
        </ul>
      </div>

      {answers?.length > 0 && (
        <div className="section-card">
          <h3>Copy all prepared answers</h3>
          <button className="btn btn-secondary btn-lg" onClick={handleCopyAll}>
            📋 Copy all answers
          </button>
        </div>
      )}
    </>
  );
}

function buildAnswers(report, posting, profile) {
  if (!report) return [];

  const preparedAnswers = [];
  const sections = report.sections || {};
  const header = report.header || {};

  if (header.applicationHook) {
    preparedAnswers.push({
      label: 'Application Hook / Cover Letter Opening',
      content: header.applicationHook,
      source: 'Report header',
    });
  }

  const blockD = sections.block_d || sections.culture__company || '';
  if (blockD) {
    preparedAnswers.push({
      label: 'Why This Company?',
      content: cleanMarkdown(blockD),
      source: 'Block D — Culture & Company',
    });
  }

  const blockB = sections.block_b || sections.north_star_alignment || '';
  if (blockB) {
    preparedAnswers.push({
      label: 'Career Alignment',
      content: cleanMarkdown(blockB),
      source: 'Block B — North Star',
    });
  }

  const blockA = sections.block_a || sections.cv_match || sections.role_summary || '';
  if (blockA) {
    preparedAnswers.push({
      label: 'Technical Experience Match',
      content: cleanMarkdown(blockA),
      source: 'Block A — CV Match',
    });
  }

  const blockC = sections.block_c || sections.compensation || '';
  if (blockC) {
    preparedAnswers.push({
      label: 'Salary Expectations',
      content: cleanMarkdown(blockC),
      source: 'Block C — Compensation',
    });
  }

  preparedAnswers.push({
    label: 'Work Authorization',
    content: `Visa / work authorization status: ${profile?.visa_status || 'Indian citizen — requires visa or work-permit sponsorship for EU/US/AU roles.'}`,
    source: 'config/profile.yml',
  });

  if (header.recommendation) {
    preparedAnswers.push({
      label: 'Recommendation Snapshot',
      content: header.recommendation,
      source: 'Report recommendation',
    });
  }

  if (posting.notes) {
    preparedAnswers.push({
      label: 'Tracker Notes',
      content: posting.notes,
      source: 'data/applications.md',
    });
  }

  return preparedAnswers;
}

function buildAutofillAnswers({ fields, profile, answers }) {
  const fullName = profile?.fullName || '';
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ');
  const linkedin = normalizeUrl(profile?.linkedin);
  const portfolio = normalizeUrl(profile?.portfolioUrl);
  const github = normalizeUrl(profile?.github);

  const applicationHook = findAnswer(answers, 'Application Hook');
  const whyCompany = findAnswer(answers, 'Why This Company');
  const careerAlignment = findAnswer(answers, 'Career Alignment');
  const technicalMatch = findAnswer(answers, 'Technical Experience Match');
  const salary = findAnswer(answers, 'Salary Expectations') || profile?.targetRange || '';
  const workAuth = findAnswer(answers, 'Work Authorization');

  const result = {};

  fields.forEach((field) => {
    const label = String(field.label || '').toLowerCase();
    const name = String(field.name || '').toLowerCase();
    const placeholder = String(field.placeholder || '').toLowerCase();
    const combined = `${label} ${name} ${placeholder}`.trim();

    if (!combined || field.inputType === 'file') return;

    const setValue = (value) => {
      if (value === undefined || value === null || value === '') return;
      result[field.id] = { value };
    };

    if (/first name|given name/.test(combined)) return setValue(firstName);
    if (/last name|family name|surname/.test(combined)) return setValue(lastName);
    if ((/full name|candidate name|your name/.test(combined) || combined === 'name') && fullName) return setValue(fullName);
    if (/email/.test(combined)) return setValue(profile?.email || '');
    if (/phone|mobile|contact number/.test(combined)) return setValue(profile?.phone || '');
    if (/linkedin/.test(combined)) return setValue(linkedin);
    if (/github/.test(combined)) return setValue(github);
    if (/portfolio|website|personal site|url/.test(combined)) return setValue(portfolio);
    if (/location|city|address|where are you based/.test(combined)) return setValue(profile?.location || '');

    if (/cover letter|motivation|why do you want|why are you interested|why this company/.test(combined)) {
      return setValue(composeAnswer([whyCompany, applicationHook]));
    }

    if (/about you|summary|tell us about yourself|background|experience/.test(combined)) {
      return setValue(composeAnswer([technicalMatch, careerAlignment, applicationHook]));
    }

    if (/additional information|anything else|notes/.test(combined)) {
      return setValue(composeAnswer([applicationHook, technicalMatch]));
    }

    if (/salary|compensation|expected pay|expected ctc|expectations/.test(combined)) {
      return setValue(salary);
    }

    if (/require sponsorship|need sponsorship|visa sponsorship/.test(combined)) {
      return setValue('Yes');
    }

    if (/relocate|open to relocation/.test(combined)) {
      return setValue('Yes');
    }

    if (/visa|work authorization|right to work/.test(combined) && field.tagName === 'textarea') {
      return setValue(workAuth);
    }
  });

  return result;
}

function composeAnswer(parts) {
  return parts
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join('\n\n');
}

function findAnswer(answers, labelPart) {
  return answers?.find((answer) => answer.label.toLowerCase().includes(labelPart.toLowerCase()))?.content || '';
}

function normalizeUrl(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function isErrorMessage(message) {
  return /error|failed|could not|couldn't|no active tab/i.test(message || '');
}

function cleanMarkdown(md) {
  return String(md || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\|[^\n]+\|/g, '')
    .replace(/---+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function simpleMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^[|](.+)[|]$/gm, (match) => {
      const cells = match.split('|').filter((cell) => cell.trim()).map((cell) => `<td>${cell.trim()}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');
  html = html.replace(/(<tr>.*?<\/tr>)+/g, '<table>$&</table>');

  return `<p>${html}</p>`;
}
