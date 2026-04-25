#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Extract 100 URLs from pipeline.md
const pipelineFile = 'data/pipeline.md';
const pipelineContent = fs.readFileSync(pipelineFile, 'utf-8');
const lines = pipelineContent.split('\n');

// Find the starting line (after #126) and get 100 [ ] entries
let urls = [];
let foundStart = false;
const urlMap = new Map(); // Track line numbers for updating later

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Find #126 marker
  if (line.includes('[x] #126')) {
    foundStart = true;
    continue;
  }
  
  if (foundStart && line.match(/^\s*-\s*\[\s*\]\s*https?/)) {
    const match = line.match(/https?:\/\/[^\s|]+/);
    const urlStr = match ? match[0] : '';
    const companyMatch = line.match(/\|\s*([^|]+)\s*\|/);
    const company = companyMatch ? companyMatch[1].trim() : '';
    const roleMatch = line.match(/\|\s*([^|]+)\s*\|/g);
    const role = roleMatch && roleMatch[1] ? roleMatch[1].trim() : '';
    
    urls.push({
      lineNum: i,
      line: line,
      reportNum: urls.length + 130, // Start at 130 since 129 is last
      url: urlStr,
      company: company,
      role: role
    });
    
    urlMap.set(i, line);
    
    if (urls.length >= 100) break;
  }
}

// Save URLs to a JSON file for the batch processor
const outputFile = 'batch/urls-to-process.json';
fs.writeFileSync(outputFile, JSON.stringify({
  totalUrls: urls.length,
  startReport: 130,
  endReport: 229,
  urls: urls,
  startDate: new Date().toISOString()
}, null, 2));

console.log(`✓ Extracted ${urls.length} URLs`);
console.log(`✓ Report numbers: 130-229`);
console.log(`✓ Saved to: ${outputFile}`);

// Show first 5 and last 5 URLs
console.log('\nFirst 5 URLs:');
urls.slice(0, 5).forEach((u, i) => {
  console.log(`  ${u.reportNum}. ${u.company} — ${u.role}`);
});

console.log('\nLast 5 URLs:');
urls.slice(-5).forEach((u, i) => {
  console.log(`  ${u.reportNum}. ${u.company} — ${u.role}`);
});

