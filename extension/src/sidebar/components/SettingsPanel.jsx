import React, { useCallback, useEffect, useState } from 'react';

export default function SettingsPanel({ onBack, onRootSaved }) {
  const [currentRoot, setCurrentRoot] = useState('');
  const [rootInput, setRootInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setMessage('');

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_SERVER_SETTINGS' });
      if (!resp?.success) {
        throw new Error(resp?.error || 'Could not load server settings');
      }
      setCurrentRoot(resp.rootPath || '');
      setRootInput(resp.rootPath || '');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveRoot = useCallback(async () => {
    setSaving(true);
    setMessage('');

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'SET_SERVER_SETTINGS',
        payload: { rootPath: rootInput },
      });

      if (!resp?.success) {
        throw new Error(resp?.error || 'Failed to save server settings');
      }

      setCurrentRoot(resp.rootPath || '');
      setRootInput(resp.rootPath || '');
      setMessage(resp.message || 'Root directory saved successfully.');
      if (onRootSaved) onRootSaved();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }, [rootInput, onRootSaved]);

  return (
    <div className="section-card">
      <div className="section-header">
        <button className="btn btn-secondary" onClick={onBack}>← Back</button>
        <h2>Settings</h2>
      </div>

      <p className="text-sm text-muted">
        Optionally set the root folder that the local daemon uses to serve your career-ops repository content.
      </p>

      <div className="field-group">
        <label htmlFor="rootPath">Current Daemon root</label>
        <input
          id="rootPath"
          type="text"
          className="text-input"
          value={rootInput}
          onChange={(event) => setRootInput(event.target.value)}
          disabled={loading || saving}
          placeholder="Enter absolute path to career-ops root"
        />
      </div>

      <div className="inline-controls mt-md">
        <button
          className="btn btn-primary"
          onClick={saveRoot}
          disabled={saving || loading || !rootInput.trim()}
        >
          {saving ? 'Saving…' : 'Save root directory'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={loadSettings}
          disabled={loading || saving}
        >
          Refresh
        </button>
      </div>

      {message && <div className="inline-message info mt-md">{message}</div>}
      {loading && <div className="inline-message muted mt-md">Loading current server settings…</div>}

      <div className="section-card mt-md">
        <h3>Usage</h3>
        <p className="text-sm text-muted">
          This changes the directory that the local daemon reads for `data/`, `reports/`, `cv.md`, `config/profile.yml`, and other career-ops files.
        </p>
        <p className="text-sm text-muted">
          The daemon must be running at <code>http://localhost:3737</code> for this to work.
        </p>
      </div>
    </div>
  );
}
