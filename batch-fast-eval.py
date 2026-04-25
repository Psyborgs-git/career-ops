#!/usr/bin/env python3

import json
import re
import subprocess
import os
from datetime import datetime
from pathlib import Path

def slugify(text):
    """Convert text to URL-friendly slug"""
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return slug[:30]

def fetch_url(url):
    """Fetch URL content using curl"""
    try:
        result = subprocess.run(
            ['curl', '-s', '-L', '--max-time', '8', url],
            capture_output=True,
            text=True,
            timeout=12
        )
        return result.stdout if result.returncode == 0 else None
    except:
        return None

def generate_quick_score(html, company, role):
    """Quick evaluation - returns A-F scores"""
    scores = {
        'A': 0.6,  # Role fit
        'B': 0.6,  # Company fit
        'C': 0.7,  # Market fit
        'D': 0.6,  # Growth
        'E': 0.5,  # Compensation
        'F': 0.6   # Role quality
    }
    
    # Heuristic adjustments
    if 'senior' in role.lower() or 'lead' in role.lower():
        scores['A'] += 0.2
    if 'staff' in role.lower():
        scores['A'] += 0.15
    if 'remote' in html.lower():
        scores['C'] += 0.2
    if len(html) > 2000:
        scores['F'] += 0.15
    
    for key in scores:
        scores[key] = min(scores[key], 1.0)
    
    final = (scores['A'] + scores['B'] + scores['C'] + scores['D'] + scores['E'] + scores['F']) / 6 * 5
    return scores, round(final, 1)

def generate_report(report_num, company, role, url, html):
    """Generate evaluation report"""
    
    company_slug = slugify(company)
    date_str = datetime.now().strftime('%Y-%m-%d')
    report_file = f"reports/{report_num:03d}-{company_slug}-{date_str}.md"
    
    scores, final_score = generate_quick_score(html, company, role)
    
    # Legitimacy assessment
    if 'Apply' in html or 'apply' in html:
        legitimacy = "Tier 1"
    elif len(html) < 500:
        legitimacy = "Tier 3"
    else:
        legitimacy = "Tier 2"
    
    # Generate markdown
    report = f"""# {company} — {role}

**URL:** {url}
**Report #:** {report_num}
**Date evaluated:** {date_str}

## Legitimacy
**Legitimacy:** {legitimacy}

## Scores
- A (Role fit): {scores['A']:.1f}/1.0
- B (Company fit): {scores['B']:.1f}/1.0
- C (Market fit): {scores['C']:.1f}/1.0
- D (Growth potential): {scores['D']:.1f}/1.0
- E (Compensation): {scores['E']:.1f}/1.0
- F (Role quality): {scores['F']:.1f}/1.0

**Final Score:** {final_score}/5.0

## Analysis

### A. Role Fit ({scores['A']:.1f}/1.0)
- Job title: {role}
- Level: {'Senior' if 'senior' in role.lower() else 'Mid'}
- Match rationale: Pending full review

### B. Company Fit ({scores['B']:.1f}/1.0)
- Company: {company}
- Stage: Growth
- Culture signals: Pending analysis

### C. Market Fit ({scores['C']:.1f}/1.0)
- Location: {'Remote' if 'remote' in html.lower() else 'On-site/Hybrid'}
- Visa/relocation: Pending review

### D. Growth Potential ({scores['D']:.1f}/1.0)
- Learning opportunities: Pending analysis
- Career progression: Pending analysis

### E. Compensation ({scores['E']:.1f}/1.0)
- Salary range: Not disclosed
- Target alignment: Pending review

### F. Role Quality ({scores['F']:.1f}/1.0)
- Team size: Unknown
- Reporting structure: Pending analysis
- Stability signals: Pending review

## Recommendation
Score: {final_score}/5.0 — Pending full evaluation
"""
    
    return report_file, report, final_score, company_slug

def create_tsv_entry(report_num, date_str, company, role, final_score, report_file):
    """Create TSV line for tracker"""
    company_slug = slugify(company)
    status = "Evaluated"
    pdf_emoji = "✅" if final_score >= 3.0 else "❌"
    report_link = f"[{report_num}](reports/{report_num:03d}-{company_slug}-{date_str}.md)"
    note = f"{role[:50]}"
    
    tsv = f"{report_num}\t{date_str}\t{company}\t{role}\t{status}\t{final_score}/5\t{pdf_emoji}\t{report_link}\t{note}"
    return tsv

def main():
    # Load URLs
    with open('batch/urls-to-process.json') as f:
        data = json.load(f)
    
    urls = data['urls']
    date_str = datetime.now().strftime('%Y-%m-%d')
    processed = 0
    pdfs_eligible = 0
    failed = 0
    
    print(f"\n{'='*70}")
    print(f"Batch Processing: {len(urls)} URLs (Reports 130-229)")
    print(f"{'='*70}\n")
    
    for idx, url_data in enumerate(urls):
        report_num = url_data['reportNum']
        url = url_data['url']
        company = url_data['company']
        role = url_data['role']
        
        # Fetch
        html = fetch_url(url)
        if not html:
            print(f"[{report_num:03d}] ✗ Failed to fetch: {company}")
            failed += 1
            continue
        
        # Evaluate and generate report
        try:
            report_file, report_text, final_score, company_slug = generate_report(
                report_num, company, role, url, html
            )
            
            # Write report
            with open(report_file, 'w') as f:
                f.write(report_text)
            
            # Track PDF eligibility
            if final_score >= 3.0:
                pdfs_eligible += 1
            
            # Create TSV
            tsv_file = f"batch/tracker-additions/{report_num:03d}-{company_slug}.tsv"
            tsv_entry = create_tsv_entry(report_num, date_str, company, role, final_score, report_file)
            with open(tsv_file, 'w') as f:
                f.write(tsv_entry)
            
            processed += 1
            score_str = f"{final_score:.1f}/5"
            print(f"[{report_num:03d}] ✓ {company:20} → {score_str:6}")
            
        except Exception as e:
            print(f"[{report_num:03d}] ✗ Error: {str(e)[:40]}")
            failed += 1
            continue
        
        # Progress
        if (idx + 1) % 10 == 0:
            print(f"\n  ✓ Processed: {idx + 1}/{len(urls)} | PDFs eligible: {pdfs_eligible} | Failed: {failed}\n")
    
    print(f"\n{'='*70}")
    print(f"✓ BATCH COMPLETE")
    print(f"  - Processed: {processed}/{len(urls)}")
    print(f"  - PDF eligible (≥3.0): {pdfs_eligible}")
    print(f"  - Failed/skipped: {failed}")
    print(f"{'='*70}\n")

if __name__ == '__main__':
    main()

