#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Extract 100 URLs from pipeline.md
const pipelineFile = 'data/pipeline.md';
const pipelineContent = fs.readFileSync(pipelineFile, 'utf-8');
const lines = pipelineContent.split('\n');

// Find the starting line (after #126) and get 100 [ ] entries
let urls = [];
let foundStart = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Find #126 marker
  if (line.includes('[x] #126')) {
    foundStart = true;
    continue;
  }
  
  if (foundStart && line.match(/^\s*-\s*\[\s*\]\s*https?/)) {
    urls.push({
      lineNum: i,
      line: line,
      index: urls.length + 127 // Report number starts at 127
    });
    
    if (urls.length >= 100) break;
  }
}

console.log(`Found ${urls.length} URLs to process`);
console.log(`Starting report numbers: 127-${urls.length + 126}`);

// Output URL list for processing
console.log('\n=== URLS TO PROCESS ===\n');
urls.forEach((item, idx) => {
  const match = item.line.match(/https?:\/\/[^\s|]+/);
  if (match) {
    console.log(`${idx + 1}. [${item.index}] ${match[0]}`);
  }
});

