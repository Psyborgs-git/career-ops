import React, { useState, useCallback } from 'react';

export default function AnswerCard({ label, content, source }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <div className="answer-card">
      <div className="answer-header">
        <span className="answer-label">{label}</span>
        <button
          className={`copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <div className="answer-body">{content}</div>
      {source && <div className="answer-source">Source: {source}</div>}
    </div>
  );
}
