import React from 'react';

export default function ReviewPanel({ posting, formFields, answers, cvData, onSubmit, onCancel }) {
  const [editedAnswers, setEditedAnswers] = React.useState(answers || {});

  const fieldLookup = React.useMemo(() => {
    const entries = (formFields || []).map((field) => [field.id, field]);
    return Object.fromEntries(entries);
  }, [formFields]);

  const handleAnswerChange = (fieldId, newValue) => {
    setEditedAnswers(prev => ({
      ...prev,
      [fieldId]: { ...prev[fieldId], value: newValue }
    }));
  };

  return (
    <div className="review-panel">
      <div className="review-header">
        <h3>Review Before Submit</h3>
        <p>{posting.company} — {posting.role}</p>
      </div>

      <div className="review-sections">
        {/* CV Preview */}
        <section className="review-section">
          <h4>📄 Resume/CV</h4>
          {cvData ? (
            <div className="cv-preview">
              <p className="filename">{cvData.fileName}</p>
              <button className="btn-secondary">Download CV</button>
              <p className="note">✅ Will auto-upload to application</p>
            </div>
          ) : (
            <p className="placeholder">CV will be generated...</p>
          )}
        </section>

        {/* Form Answers */}
        <section className="review-section">
          <h4>📝 Form Answers</h4>
          <div className="answers-list">
            {Object.entries(editedAnswers || {}).map(([fieldId, answer]) => (
              <div key={fieldId} className="answer-item">
                <label>{fieldLookup[fieldId]?.label || fieldLookup[fieldId]?.name || answer.source || fieldId}</label>
                <textarea
                  value={answer.value}
                  onChange={(e) => handleAnswerChange(fieldId, e.target.value)}
                  rows={answer.value?.split('\n').length + 1 || 3}
                  className="answer-textarea"
                />
                <span className="confidence">{answer.confidence}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Checklist */}
        <section className="review-section">
          <h4>✓ Pre-Submit Checklist</h4>
          <ul className="checklist">
            <li>
              <input type="checkbox" id="cv-ready" defaultChecked disabled />
              <label htmlFor="cv-ready">CV generated and ready</label>
            </li>
            <li>
              <input type="checkbox" id="forms-filled" defaultChecked disabled />
              <label htmlFor="forms-filled">All required fields filled</label>
            </li>
            <li>
              <input type="checkbox" id="review-complete" />
              <label htmlFor="review-complete">I have reviewed all information</label>
            </li>
            <li>
              <input type="checkbox" id="accuracy" />
              <label htmlFor="accuracy">Information is accurate and up-to-date</label>
            </li>
          </ul>
        </section>
      </div>

      <div className="review-actions">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={onSubmit} className="btn-primary btn-large">
          ✓ Submit Application
        </button>
      </div>

      <p className="disclaimer">
        ⚠️ A new tab with the application will be filled automatically. Please review and click final Submit/Apply button if everything looks correct.
      </p>
    </div>
  );
}
