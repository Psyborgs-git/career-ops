import React from 'react';

function getScoreClass(score) {
  if (score >= 4.5) return 'score-hot';
  if (score >= 4.0) return 'score-high';
  if (score >= 3.5) return 'score-mid';
  return 'score-low';
}

function getStatusClass(status) {
  return `status-${(status || '').toLowerCase().replace(/\s+/g, '-')}`;
}

function getPriorityEmoji(posting) {
  if (posting.priority === 3) return '🔥';
  if (posting.priority === 2) return '⭐⭐';
  if (posting.priority === 1) return '⭐';
  return null;
}

export default function PostingsList({ postings, onSelect, totalCount }) {
  if (!postings || postings.length === 0) {
    return (
      <div className="list-container">
        <div className="empty-state">
          <div className="emoji">📋</div>
          <p>No postings match your filters.<br />Try adjusting score or status filters.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="list-container">
      <div className="text-sm text-muted" style={{ padding: '4px 4px 8px', textAlign: 'center' }}>
        Showing {postings.length} of {totalCount}
      </div>

      {postings.map(posting => {
        const priorityEmoji = getPriorityEmoji(posting);

        return (
          <div
            key={posting.id}
            className="posting-card"
            onClick={() => onSelect(posting)}
          >
            {priorityEmoji && (
              <span className="priority-badge">{priorityEmoji}</span>
            )}

            <div className="card-top">
              <div>
                <div className="company">{posting.company}</div>
                <div className="role">{posting.role || '—'}</div>
              </div>
              <span className={`score-badge ${getScoreClass(posting.score)}`}>
                {posting.score}/5
              </span>
            </div>

            <div className="card-meta">
              <span className={`status-pill ${getStatusClass(posting.status)}`}>
                {posting.status}
              </span>
              <span className="date-tag">{posting.date}</span>
              {posting.hasPdf && <span title="CV PDF generated">📄</span>}
              {posting.url && <span title="Has application URL">🔗</span>}
            </div>

            {posting.notes && (
              <div className="notes">{posting.notes}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
