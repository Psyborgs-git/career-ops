import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AnswerCard from './AnswerCard';

function formatFieldPrompt(field, posting) {
  const label = field.label || field.name || 'this field';
  const parts = [
    `Draft a tailored answer for the application field "${label}".`,
    `Company: ${posting.company}.`,
    posting.role ? `Role: ${posting.role}.` : null,
    field.placeholder ? `Placeholder hint: ${field.placeholder}.` : null,
    Array.isArray(field.options) && field.options.length > 0
      ? `Choose or reflect one of these options when relevant: ${field.options.map((option) => option.text).join(', ')}.`
      : null,
    'Keep it truthful, specific, and ready to paste into a job application form.',
  ].filter(Boolean);

  return parts.join(' ');
}

export default function OllamaTab({ posting, reportFilename, formFields, contextFiles, onDetectForm }) {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [customQuestion, setCustomQuestion] = useState('');
  const [generatedAnswer, setGeneratedAnswer] = useState(null);

  const hasModels = models.length > 0;

  const modelOptions = useMemo(
    () => models
      .map((model) => (typeof model === 'string' ? model : model.name || ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    [models]
  );

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setError('');
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_OLLAMA_MODELS' });
      if (!resp?.success) {
        throw new Error(resp?.error || 'Could not load Ollama models');
      }

      const normalizedModels = (resp.models || []).map((model) => (
        typeof model === 'string' ? { name: model } : model
      ));
      setModels(normalizedModels);

      if (!selectedModel && normalizedModels[0]?.name) {
        setSelectedModel(normalizedModels[0].name);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingModels(false);
    }
  }, [selectedModel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const runGeneration = useCallback(async ({ question, field }) => {
    if (!selectedModel) {
      setError('Pick an Ollama model first.');
      return;
    }

    setGenerating(true);
    setError('');

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'GENERATE_OLLAMA_ANSWER',
        payload: {
          model: selectedModel,
          question,
          reportFilename,
          fieldLabel: field?.label || field?.name || '',
          fieldMeta: field || null,
        },
      });

      if (!resp?.success) {
        throw new Error(resp?.error || 'Generation failed');
      }

      setGeneratedAnswer({
        label: field?.label || 'Custom prompt',
        content: resp.answer,
        source: `${resp.model} · ${resp.contextFiles?.join(', ') || 'workspace context'}`,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }, [reportFilename, selectedModel]);

  return (
    <>
      <div className="section-card">
        <h3>Ollama Assistant</h3>
        <p className="text-sm text-muted">
          Uses your local Ollama models plus the selected report, `cv.md`, `config/profile.yml`, `modes/_profile.md`, and other available repo context to draft paste-ready answers.
        </p>

        <div className="inline-controls mt-md">
          <select
            className="status-select"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            disabled={loadingModels || !hasModels}
          >
            {hasModels ? modelOptions.map((modelName) => (
              <option key={modelName} value={modelName}>{modelName}</option>
            )) : (
              <option value="">No models detected</option>
            )}
          </select>
          <button className="btn btn-secondary" onClick={loadModels} disabled={loadingModels}>
            {loadingModels ? 'Refreshing…' : '↻ Refresh models'}
          </button>
          <button className="btn btn-secondary" onClick={onDetectForm}>
            🧭 Detect form fields
          </button>
        </div>

        {error && <div className="inline-message error mt-md">{error}</div>}
      </div>

      <div className="section-card">
        <h3>Ask anything</h3>
        <textarea
          className="prompt-textarea"
          rows={6}
          placeholder="Example: Draft a crisp answer for 'Why do you want to join this company?' tailored to this role."
          value={customQuestion}
          onChange={(event) => setCustomQuestion(event.target.value)}
        />
        <div className="inline-controls mt-md">
          <button
            className="btn btn-primary"
            onClick={() => runGeneration({ question: customQuestion })}
            disabled={generating || !customQuestion.trim()}
          >
            {generating ? 'Generating…' : '✨ Generate answer'}
          </button>
        </div>
      </div>

      <div className="section-card">
        <h3>Context in play</h3>
        <div className="pill-list">
          {(contextFiles || []).map((file) => (
            <span className="info-pill" key={file.path || file}>{file.label || file.path || file}</span>
          ))}
          {(!contextFiles || contextFiles.length === 0) && (
            <span className="text-muted text-sm">No context files surfaced yet.</span>
          )}
        </div>
      </div>

      <div className="section-card">
        <h3>Detected form fields</h3>
        {formFields?.length ? (
          <div className="field-list">
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
                <button
                  className="btn btn-secondary"
                  onClick={() => runGeneration({
                    question: formatFieldPrompt(field, posting),
                    field,
                  })}
                  disabled={generating || !selectedModel}
                >
                  Generate
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">
            Detect the active application form first, then generate answers field by field.
          </p>
        )}
      </div>

      {generatedAnswer && (
        <AnswerCard
          label={generatedAnswer.label}
          content={generatedAnswer.content}
          source={generatedAnswer.source}
        />
      )}
    </>
  );
}
