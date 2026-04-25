import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './sidebar.css';
import PostingsList from './components/PostingsList';
import PostingDetail from './components/PostingDetail';
import SettingsPanel from './components/SettingsPanel';

const SCORE_FILTERS = [
  { label: '🔥 ≥4.0', value: 4.0 },
  { label: '⭐ ≥3.5', value: 3.5 },
  { label: 'All', value: 0 },
];

const STATUS_FILTERS = ['All', 'Evaluated', 'Applied', 'Interview', 'Offer'];

export default function App() {
  const [view, setView] = useState('list');
  const [postings, setPostings] = useState([]);
  const [profile, setProfile] = useState({});
  const [cv, setCv] = useState('');
  const [pdfs, setPdfs] = useState([]);
  const [contextFiles, setContextFiles] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [selectedPosting, setSelectedPosting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState(4.0);
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortBy, setSortBy] = useState('score'); // 'score' | 'date' | 'priority'

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_POSTINGS' });
      if (resp?.error) throw new Error(resp.error);
      setPostings(resp.postings || []);
      setProfile(resp.profile || {});
      setCv(resp.cv || '');
      setPdfs(resp.pdfs || []);
      setContextFiles(resp.contextFiles || []);
      setLastSync(resp.lastSync);
    } catch (err) {
      setError(`Failed to load data: ${err.message}. Is the daemon running? (npm run daemon)`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Force sync
  const handleSync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'SYNC_DATA' });
      if (resp?.error) throw new Error(resp.error);
      setPostings(resp.postings || []);
      setProfile(resp.profile || {});
      setCv(resp.cv || '');
      setPdfs(resp.pdfs || []);
      setContextFiles(resp.contextFiles || []);
      setLastSync(resp.lastSync);
    } catch (err) {
      setError(`Sync failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Filtered + sorted postings
  const filteredPostings = useMemo(() => {
    let list = postings;

    // Score filter
    if (scoreFilter > 0) {
      list = list.filter(p => p.score >= scoreFilter);
    }

    // Status filter
    if (statusFilter !== 'All') {
      list = list.filter(p => p.status === statusFilter);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.company.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      );
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'date') return new Date(b.date) - new Date(a.date);
      if (sortBy === 'priority') return b.priority - a.priority || b.score - a.score;
      return 0;
    });

    return list;
  }, [postings, scoreFilter, statusFilter, search, sortBy]);

  // Status update handler
  const handleStatusUpdate = useCallback(async (postingNumber, newStatus) => {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'UPDATE_STATUS',
        payload: { postingNumber, status: newStatus },
      });
      if (resp?.success) {
        // Update local state
        setPostings(prev => prev.map(p =>
          p.number === postingNumber ? { ...p, status: newStatus } : p
        ));
        // Also update selectedPosting if it's the one being changed
        if (selectedPosting?.number === postingNumber) {
          setSelectedPosting(prev => ({ ...prev, status: newStatus }));
        }
      } else {
        setError(`Status update failed: ${resp?.error || resp?.message}`);
      }
    } catch (err) {
      setError(`Status update failed: ${err.message}`);
    }
  }, [selectedPosting]);

  // Select posting
  const handleSelect = useCallback((posting) => {
    setSelectedPosting(posting);
    setView('detail');
  }, []);

  const handleBack = useCallback(() => {
    setView('list');
    setSelectedPosting(null);
  }, []);

  // Count stats
  const totalEvaluated = postings.filter(p => p.status === 'Evaluated').length;
  const highScore = postings.filter(p => p.score >= 4.0).length;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-top">
          <h1>Career-Ops</h1>
          <div className="header-actions">
            <button className="btn btn-secondary" onClick={() => setView('settings')} title="Open settings">
              ⚙️ Settings
            </button>
            <button className="btn-icon" onClick={handleSync} title="Sync data">↻</button>
          </div>
        </div>
        <div className="header-gradient" />
        <div className="stats">
          <strong>{highScore}</strong> high-priority · <strong>{totalEvaluated}</strong> pending · {postings.length} total
          {lastSync && <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.5 }}>
            synced {new Date(lastSync).toLocaleTimeString()}
          </span>}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {view === 'list' && (
        <>
          {/* Search */}
          <div className="controls-bar">
            <input
              type="text"
              className="search-input"
              placeholder="Search company or role…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className="sort-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="score">Score ↓</option>
              <option value="date">Recent</option>
              <option value="priority">Priority</option>
            </select>
          </div>

          {/* Filters */}
          <div className="filter-bar">
            {SCORE_FILTERS.map(f => (
              <button
                key={f.value}
                className={`filter-chip ${scoreFilter === f.value ? 'active' : ''}`}
                onClick={() => setScoreFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
            <span style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
            {STATUS_FILTERS.map(s => (
              <button
                key={s}
                className={`filter-chip ${statusFilter === s ? 'active' : ''}`}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {/* List */}
          {loading ? (
            <div className="loading-overlay">
              <div className="spinner" /><span>Loading…</span>
            </div>
          ) : (
            <PostingsList
              postings={filteredPostings}
              onSelect={handleSelect}
              totalCount={postings.length}
            />
          )}
        </>
      )}

      {view === 'detail' && selectedPosting && (
        <PostingDetail
          posting={selectedPosting}
          profile={profile}
          cv={cv}
          pdfs={pdfs}
          contextFiles={contextFiles}
          onBack={handleBack}
          onStatusUpdate={handleStatusUpdate}
        />
      )}

      {view === 'settings' && (
        <SettingsPanel
          onBack={() => setView('list')}
          onRootSaved={loadData}
        />
      )}
    </div>
  );
}
