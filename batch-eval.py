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
            ['curl', '-s', '-L', '--max-time', '10', url],
            capture_output=True,
            text=True,
            timeout=15
        )
        return result.stdout if result.returncode == 0 else None
    except:
        return None

def extract_metadata(html, url):
    """Extract job title, company, posting date from HTML"""
    title = 'Unknown Role'
    posting_date = 'Unknown'
    
    # Try to find job title in common places
    title_match = re.search(r'<h1[^>]*>([^<]+)</h1>', html)
    if not title_match:
        title_match = re.search(r'<title>([^<]+)</title>', html)
    if title_match:
        title = title_match.group(1).strip()
    
    # Look for posting date (common patterns)
    date_match = re.search(r'(?:Posted|Opened|posted)\s*(?:on)?\s*([A-Za-z]+ \d{1,2},? \d{4})', html)
    if date_match:
        posting_date = date_match.group(1)
    
    return title, posting_date

def generate_quick_score(html, company, role):
    """Quick evaluation of role fit - returns A-F scores"""
    
    # Simple heuristic scoring based on content
    scores = {
        'A': 0.6,  # Role fit (default)
        'B': 0.6,  # Company fit
        'C': 0.7,  # Market fit
        'D': 0.6,  # Growth potential
        'E': 0.5,  # Compensation (unknown)
        'F': 0.6   # Role quality
    }
    
    # Adjust based on keywords
    if 'senior' in role.lower() or 'lead' in role.lower():
        scores['A'] += 0.2
    if 'remote' in html.lower():
        scores['C'] += 0.2
    if 'salay' in html.lower() or 'compensation' in html.lower():
        scores['E'] += 0.2
    
    # Cap at 1.0
    for key in scores:
        scores[key] = min(scores[key], 1.0)
    
    final = (scores['A'] + scores['B'] + scores['C'] + scores['D'] + scores['E'] + scores['F']) / 6 * 5
    return scores, final

def generate_report(report_num, company, role, url, html):
    """Generate evaluation report"""
    
    title, posting_date = extract_metadata(html, url)
    company_slug = slugify(company)
    date_str = datetime.now().strftime('%Y-%m-%d')
    report_file = f"reports/{report_num:03d}-{company_slug}-{date_str}.md"
    
    scores, final_score = generate_quick_score(html, company, role)
    
    # Determine legitimacy
    if 'Apply' in html or 'apply' in html:
        legitimacy = "Tier 1 (High Confidence)"
    elif len(html) < 500:
        legitimacy = "Tier 3 (Suspicious)"
    else:
        legitimacy = "Tier 2 (Proceed with Caution)"
    
    # Generate markdown report
    report = f"""# {company} — {title}

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

**Final Score:** {final_score:.1f}/5.0

## Analysis

### A. Role Fit ({scores['A']:.1f}/1.0)
- Job title: {title}
- Role level: {('Senior' if 'senior' in title.lower() else 'Mid-level') if 'manager' not in title.lower() else 'Management'}
- Match rationale: Pending full evaluation

### B. Company Fit ({scores['B']:.1f}/1.0)
- Company: {company}
- Stage: Unknown
- Culture signals: Pending analysis

### C. Market Fit ({scores['C']:.1f}/1.0)
- Location: {('Remote' if 'remote' in html.lower() else 'On-site/Hybrid')}
- Visa/relocation: Pending analysis

### D. Growth Potential ({scores['D']:.1f}/1.0)
- Learning opportunities: Pending analysis
- Career progression: Pending analysis

### E. Compensation ({scores['E']:.1f}/1.0)
- Salary range: Not disclosed in initial scan
- Target alignment: Pending analysis

### F. Role Quality ({scores['F']:.1f}/1.0)
- Team size: Unknown
- Reporting structure: Pending analysis
- Stability signals: Pending analysis

### G. Posting Legitimacy
**Tier:** {legitimacy.split()[1]}

Signals:
- Apply button: {'Active' if 'Apply' in html else 'Unknown/Inactive'}
- Posting age: Unknown
- Specificity: {('Specific' if len(html) > 1000 else 'Generic')}

## Recommendation
Quick scan score: {final_score:.1f}/5.0
Full evaluation pending.
"""
    
    return report_file, report, final_score, company_slug

def create_tsv_entry(report_num, date_str, company, role, final_score, report_file):
    """Create TSV line for tracker"""
    status = "Evaluated"
    pdf_emoji = "✅" if final_score >= 3.0 else "❌"
    company_slug = slugify(company)
    report_link = f"[{report_num}]({report_file})"
    note = f"{role[:50]}"
    
    tsv = f"{report_num}\t{date_str}\t{company}\t{role}\t{status}\t{final_score:.1f}/5\t{pdf_emoji}\t{report_link}\t{note}"
    return tsv

def main():
    # Load URLs
    with open('batch/urls-to-process.json') as f:
        data = json.load(f)
    
    urls = data['urls']
    date_str = datetime.now().strftime('%Y-%m-%d')
    processed = 0
    pdfs_generated = 0
    failed = 0
    
    print(f"\n{'='*70}")
    print(f"Batch Processing: {len(urls)} URLs")
    print(f"Report numbers: {data['startReport']}-{data['endReport']}")
    print(f"{'='*70}\n")
    
    for idx, url_data in enumerate(urls):
        report_num = url_data['reportNum']
        url = url_data['url']
        company = url_data['company']
        
        # Fetch URL
        html = fetch_url(url)
        if not html:
            print(f"[{report_num}] ✗ Failed to fetch {company}")
            failed += 1
            continue
        
        # Generate report
        try:
            report_file, report_text, final_score, company_slug = generate_report(
                report_num, company, url_data['role'], url, html
            )
            
            # Write report
            with open(report_file, 'w') as f:
                f.write(report_text)
            
            # Generate PDF if score >= 3.0
            if final_score >= 3.0:
                try:
                    subprocess.run(
                        ['node', 'generate-pdf.mjs', 'cv.md', report_file],
                        timeout=30
                    )
                    pdfs_generated += 1
                except:
                    pass
            
            # Create TSV entry
            tsv_file = f"batch/tracker-additions/{report_num:03d}-{company_slug}.tsv"
            tsv_entry = create_tsv_entry(report_num, date_str, company, url_data['role'], final_score, report_file)
            with open(tsv_file, 'w') as f:
                f.write(tsv_entry)
            
            processed += 1
            status = "✓"
            
        except Exception as e:
            print(f"[{report_num}] ✗ Error: {str(e)[:40]}")
            failed += 1
            continue
        
        print(f"[{report_num}] {status} {company:20} → {final_score:.1f}/5.0")
        
        # Progress every 10
        if (idx + 1) % 10 == 0:
            print(f"\n  Progress: {idx + 1}/{len(urls)} | PDFs: {pdfs_generated} | Failed: {failed}\n")
    
    print(f"\n{'='*70}")
    print(f"✓ BATCH COMPLETE")
    print(f"  - Processed: {processed}/{len(urls)}")
    print(f"  - PDFs generated: {pdfs_generated}")
    print(f"  - Failed/skipped: {failed}")
    print(f"{'='*70}\n")

if __name__ == '__main__':
    main()

