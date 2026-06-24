#!/usr/bin/env python3
"""
Cleanup Script — Corrupted Customer Records
============================================
Finds Customer.email / Customer.phone values that match a document's
claimInfo.adjusterEmail / claimInfo.adjusterPhone / carrier contacts /
contractor / mortgage company contacts, and reverts them to NULL.

Default mode: DRY RUN — reports what would be changed, changes nothing.
Apply mode:   --apply    — actually performs the cleanup.

For each suspected corruption:
  1. Logs: customer id, customer name, current value, matching source document,
     matching extracted path, proposed correction
  2. Only applies when confidence is HIGH (exact value match against an
     adjuster/carrier/contractor/mortgage field in any of the customer's
     related documents).
  3. On apply:
     - Sets Customer.email and/or Customer.phone back to NULL
     - Saves the orphaned adjuster/carrier info to ContractorMemory so the
       data is not lost (a human can later re-link it to a real Adjuster /
       Carrier record if desired)
     - Writes a memory note explaining what was cleaned and why

Usage:
    python3 scripts/cleanup-corrupted-customers.py            # dry-run
    python3 scripts/cleanup-corrupted-customers.py --apply    # actually fix

Exit codes:
    0 — clean run (no errors; may or may not have found corruption)
    1 — error during execution
    2 — bad arguments
"""
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime

DB_PATH = '/home/z/my-project/db/custom.db'

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
parser = argparse.ArgumentParser(description='Clean corrupted Customer.email/phone values.')
parser.add_argument('--apply', action='store_true', help='Actually perform the cleanup (default is dry-run).')
parser.add_argument('--contractor-id', default=None, help='Restrict to one contractor (default: all contractors).')
args = parser.parse_args()

DRY_RUN = not args.apply
if DRY_RUN:
    print('=== DRY RUN — no changes will be made. Pass --apply to actually clean up. ===\n')
else:
    print('=== APPLY MODE — corrupted records WILL be modified. ===\n')

if not os.path.exists(DB_PATH):
    print(f'ERROR: DB not found at {DB_PATH}', file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def db_query(sql, args=()):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute(sql, args)
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def db_exec(sql, args=()):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(sql, args)
    conn.commit()
    conn.close()

def normalize(s):
    """Normalize a phone/email for comparison. Lowercases, strips whitespace,
    and for phones strips all non-alphanumerics."""
    if s is None:
        return None
    s = str(s).strip().lower()
    if not s:
        return None
    # Phone-ish: strip everything but digits
    if '@' not in s:
        digits = ''.join(ch for ch in s if ch.isdigit())
        if digits:
            return digits
    return s

def walk_extracted(obj, path=''):
    """Walk extractedData and yield (path, value) pairs for every string."""
    if obj is None or not isinstance(obj, dict):
        return
    for k, v in obj.items():
        new_path = f'{path}.{k}' if path else k
        if isinstance(v, str) and v.strip():
            yield new_path, v.strip()
        elif isinstance(v, dict):
            yield from walk_extracted(v, new_path)
        elif isinstance(v, list):
            for i, item in enumerate(v):
                if isinstance(item, str) and item.strip():
                    yield f'{new_path}[{i}]', item.strip()
                elif isinstance(item, dict):
                    yield from walk_extracted(item, f'{new_path}[{i}]')

# Field keys we treat as adjuster / carrier / contractor / mortgage owned.
# These are the path suffixes (case-insensitive) that, if matched, mean the
# value belongs to that entity — NOT the homeowner.
OWNER_PATTERNS = [
    # (owner, path-substring-match)
    ('adjuster',   ['adjuster']),
    ('carrier',    ['carrier', 'insurancecompany', 'insurer']),
    ('contractor', ['contractor', 'roofer', 'builder']),
    ('mortgage',   ['mortgage', 'lender', 'loan_']),
]

def owner_for_path(path):
    p = path.lower()
    for owner, substrings in OWNER_PATTERNS:
        for s in substrings:
            if s in p:
                return owner
    # claimInfo.property is the insured property — belongs to homeowner
    if p.endswith('.property') or p == 'claiminfo.property':
        return 'homeowner'
    if 'homeowner' in p or 'customer' in p or 'insured' in p:
        return 'homeowner'
    return 'unknown'

# ---------------------------------------------------------------------------
# Find all customers + their related documents
# ---------------------------------------------------------------------------
where_clause = ''
sql_args = ()
if args.contractor_id:
    where_clause = 'AND c.contractorId = ?'
    sql_args = (args.contractor_id,)

customers = db_query(f'''
    SELECT c.id, c.contractorId, c.name, c.email, c.phone, c.address
    FROM Customer c
    WHERE 1=1
      {where_clause}
      AND (c.email IS NOT NULL AND c.email != ''
           OR c.phone IS NOT NULL AND c.phone != '')
''', sql_args)

print(f'Found {len(customers)} customer(s) with email or phone populated.\n')

corruption_findings = []   # list of dicts with all the details

for c in customers:
    cid = c['id']
    cust_email = c['email']
    cust_phone = c['phone']
    cust_email_norm = normalize(cust_email)
    cust_phone_norm = normalize(cust_phone)

    # Find all documents linked to this customer (direct or via projects)
    docs = db_query('''
        SELECT d.id, d.originalName, d.extractedData
        FROM Document d
        WHERE d.customerId = ?
           OR d.projectId IN (SELECT id FROM Project WHERE customerId = ?)
        AND d.extractedData IS NOT NULL
    ''', (cid, cid))

    # Track which (field, owner, path, doc) the customer's current value matches
    email_match = None   # {doc_id, doc_name, path, owner, value}
    phone_match = None

    for d in docs:
        try:
            data = json.loads(d['extractedData']) if d['extractedData'] else {}
        except Exception:
            continue

        for path, value in walk_extracted(data):
            owner = owner_for_path(path)
            value_norm = normalize(value)

            # Skip homeowner-owned matches — those are LEGITIMATE customer data
            if owner == 'homeowner':
                continue
            # Skip unknown — we can't say with confidence it's corrupt
            if owner == 'unknown':
                continue

            # Email match?
            if cust_email_norm and value_norm and '@' in value_norm and value_norm == cust_email_norm:
                if email_match is None:
                    email_match = {
                        'doc_id': d['id'],
                        'doc_name': d['originalName'],
                        'path': path,
                        'owner': owner,
                        'value': value,
                    }

            # Phone match?
            if cust_phone_norm and value_norm and '@' not in value_norm and value_norm == cust_phone_norm:
                if phone_match is None:
                    phone_match = {
                        'doc_id': d['id'],
                        'doc_name': d['originalName'],
                        'path': path,
                        'owner': owner,
                        'value': value,
                    }

    if email_match or phone_match:
        corruption_findings.append({
            'customer_id': cid,
            'customer_name': c['name'],
            'contractor_id': c['contractorId'],
            'current_email': cust_email,
            'current_phone': cust_phone,
            'email_match': email_match,
            'phone_match': phone_match,
        })

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
print(f'=== SUSPECTED CORRUPTIONS: {len(corruption_findings)} ===\n')
for f in corruption_findings:
    print(f'Customer: {f["customer_name"]}  (id={f["customer_id"]})')
    if f['email_match']:
        m = f['email_match']
        print(f'  EMAIL CORRUPT:')
        print(f'    current:    {f["current_email"]!r}')
        print(f'    matches:    {m["value"]!r}')
        print(f'    source:     "{m["doc_name"]}" (doc id={m["doc_id"]})')
        print(f'    path:       {m["path"]}')
        print(f'    owner:      {m["owner"]}')
        print(f'    proposed:   set Customer.email = NULL')
    if f['phone_match']:
        m = f['phone_match']
        print(f'  PHONE CORRUPT:')
        print(f'    current:    {f["current_phone"]!r}')
        print(f'    matches:    {m["value"]!r}')
        print(f'    source:     "{m["doc_name"]}" (doc id={m["doc_id"]})')
        print(f'    path:       {m["path"]}')
        print(f'    owner:      {m["owner"]}')
        print(f'    proposed:   set Customer.phone = NULL')
    print()

# ---------------------------------------------------------------------------
# Apply (if --apply)
# ---------------------------------------------------------------------------
if DRY_RUN:
    if corruption_findings:
        print(f'DRY RUN: would clean {len(corruption_findings)} customer(s).')
        email_count = sum(1 for f in corruption_findings if f['email_match'])
        phone_count = sum(1 for f in corruption_findings if f['phone_match'])
        print(f'  - {email_count} email field(s) would be set to NULL')
        print(f'  - {phone_count} phone field(s) would be set to NULL')
        print(f'\nTo actually apply, run: python3 {sys.argv[0]} --apply')
    else:
        print('DRY RUN: no corruptions found. Nothing to do.')
    sys.exit(0)

# APPLY mode
print('=== APPLYING CLEANUP ===\n')
applied_email = 0
applied_phone = 0
memory_notes_created = 0
errors = 0

for f in corruption_findings:
    cid = f['customer_id']
    name = f['customer_name']
    contractor_id = f['contractor_id']

    updates = {}
    if f['email_match']:
        updates['email'] = None
    if f['phone_match']:
        updates['phone'] = None

    # Build the SET clause
    set_clauses = []
    set_args = []
    for field in updates:
        set_clauses.append(f'{field} = NULL')
    set_clauses.append('updatedAt = datetime(\'now\')')
    set_args.append(cid)

    try:
        db_exec(f'UPDATE Customer SET {", ".join(set_clauses)} WHERE id = ?', tuple(set_args))
        if f['email_match']:
            applied_email += 1
        if f['phone_match']:
            applied_phone += 1
        print(f'✓ Cleaned {name}: {", ".join(updates.keys())} → NULL')
    except Exception as e:
        print(f'✗ FAILED to clean {name}: {e}')
        errors += 1
        continue

    # Save the orphaned adjuster/carrier info to memory so it isn't lost
    orphan_parts = []
    if f['email_match']:
        m = f['email_match']
        orphan_parts.append(f'email (was "{m["value"]}", owner={m["owner"]}, source="{m["doc_name"]}", path={m["path"]})')
    if f['phone_match']:
        m = f['phone_match']
        orphan_parts.append(f'phone (was "{m["value"]}", owner={m["owner"]}, source="{m["doc_name"]}", path={m["path"]})')

    note = (
        f'CLEANUP {datetime.now().isoformat()}Z — Customer "{name}" (id={cid}) '
        f'had corrupted contact info that matched an adjuster/carrier/contractor/mortgage '
        f'value found in their documents. The following field(s) were set to NULL to prevent '
        f'them being used as the customer\'s own contact: {"; ".join(orphan_parts)}. '
        f'The original values are preserved in this memory note so a human can later re-link '
        f'them to a proper Adjuster/Carrier/etc. record. Re-capture the customer\'s real '
        f'contact info directly from them.'
    )

    try:
        db_exec('''
            INSERT INTO ContractorMemory (id, contractorId, category, content, source, createdAt, updatedAt)
            VALUES (?, ?, 'key_info', ?, 'system', datetime('now'), datetime('now'))
        ''', (f'cleanup_{cid}_{int(datetime.now().timestamp())}', contractor_id, note))
        memory_notes_created += 1
    except Exception as e:
        print(f'  ⚠ Could not save memory note for {name}: {e}')

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print(f'\n=== CLEANUP COMPLETE ===')
print(f'  Customers processed:  {len(corruption_findings)}')
print(f'  Emails set to NULL:   {applied_email}')
print(f'  Phones set to NULL:   {applied_phone}')
print(f'  Memory notes saved:   {memory_notes_created}')
if errors:
    print(f'  Errors:               {errors}')
sys.exit(0 if errors == 0 else 1)
