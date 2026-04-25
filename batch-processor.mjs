#!/usr/bin/env node
/**
 * Batch processor for career-ops pipeline
 * Processes pending URLs sequentially with evaluation, report generation, PDF generation, and tracker updates
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import fetch from 'node-fetch';

const REPORT_DIR = 'reports';
const BATCH_DIR = 'batch/tracker-additions';
const OUTPUT_DIR = 'output';
const PIPELINE_FILE = 'data/pipeline.md';
const STARTING_REPORT = 77;

// Ensure directories exist
[REPORT_DIR, BATCH_DIR, OUTPUT_DIR].forEach(dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

// Read modes files for evaluation context
const modesShared = readFileSync('modes/_shared.md', 'utf-8');
const modesProfile = readFileSync('modes/_profile.md', 'utf-8');
const profile = readFileSync('config/profile.yml', 'utf-8');
const cv = readFileSync('cv.md', 'utf-8');

// Read pipeline
const pipeline = readFileSync(PIPELINE_FILE, 'utf-8');
const lines = pipeline.split('\n');

// Extract pending URLs
const pendingLines = lines
  .map((line, idx) => ({ line, idx }))
  .filter(({ line }) => line.match(/^- \[ \]/));

console.log(`Found ${pendingLines.length} pending URLs. Processing batch...`);

let reportNum = STARTING_REPORT;
let processed = 0;
let succeeded = 0;
let failed = 0;

// Example: Process first 5 for testing
const BATCH_SIZE = process.argv[2] ? parseInt(process.argv[2]) : 5;

for (let i = 0; i < Math.min(BATCH_SIZE, pendingLines.length); i++) {
  const { line, idx } = pendingLines[i];
  
  // Parse line: - [ ] URL | Company | Role
  const match = line.match(/^- \[ \] (https?:\/\/[^\s]+)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
  if (!match) {
    console.log(`  [${i+1}] SKIP: Could not parse line`);
    continue;
  }
  
  const [_, url, company, role] = match;
  console.log(`\n[${i+1}/${BATCH_SIZE}] ${company} | ${role}`);
  console.log(`     URL: ${url}`);
  
  // Placeholder for evaluation
  console.log(`     📝 Would evaluate score, generate report, PDF, TSV...`);
  
  processed++;
}

console.log(`\n✅ Batch complete: ${processed} processed, ${succeeded} succeeded, ${failed} failed`);
