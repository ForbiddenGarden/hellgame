#!/usr/bin/env python3
"""Search the jwolle1 Jeopardy dataset or the Skullspace hacker-jeopardy repo for clue ideas.

  git clone --depth 1 https://github.com/jwolle1/jeopardy_clue_dataset /tmp/jw
  tools/pick.py jeopardy /tmp/jw/combined_season1-42.tsv 'HALLOWEEN|MONSTER' --since 2000
  git clone --depth 1 https://github.com/skullspace/hacker-jeopardy /tmp/sk
  tools/pick.py skullspace /tmp/sk/old_questions 'crypto|exploit'

Prints candidates grouped by category. Copy the good ones into content/game.json
(fact-check them; old clues go stale).
"""
import argparse, csv, glob, json, os, re, sys
from collections import defaultdict

ap = argparse.ArgumentParser()
ap.add_argument('kind', choices=['jeopardy', 'skullspace'])
ap.add_argument('path')
ap.add_argument('pattern', help='regex matched against category names, case-insensitive')
ap.add_argument('--since', type=int, default=1990, help='jeopardy only: earliest air year')
ap.add_argument('--limit', type=int, default=8, help='max clues shown per category')
a = ap.parse_args()
rx = re.compile(a.pattern, re.I)
cats = defaultdict(list)

if a.kind == 'jeopardy':
    csv.field_size_limit(sys.maxsize)
    with open(a.path, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f, delimiter='\t'):
            if rx.search(r['category']) and int(r['air_date'][:4]) >= a.since and r['round'] in ('1', '2'):
                cats[f"{r['category']} ({r['air_date']})"].append((int(r['clue_value']), r['answer'], r['question']))
else:
    for fn in glob.glob(os.path.join(a.path, '**', '*.json'), recursive=True):
        raw = open(fn, encoding='utf-8', errors='replace').read().strip().rstrip(',')
        try:
            data = json.loads(raw if raw.startswith('[') else '[' + raw + ']')
        except ValueError:
            continue
        for c in data:
            if isinstance(c, dict) and rx.search(c.get('name', '')):
                cats[f"{c['name']} ({os.path.relpath(fn, a.path)})"] = [(0, q['question'], q['answer']) for q in c['questions']]

for name, rows in sorted(cats.items()):
    if len(rows) < 5 and a.kind == 'jeopardy':
        continue
    print(f'\n## {name}')
    for v, clue, ans in sorted(rows)[:a.limit]:
        print(f'  {v or "-":>5}  {clue}  =>  {ans}')
