"""
P2 Entity Classification Tests for Operations Radar
====================================================
Proves the entity-ownership fix:
  1. Adjuster email does NOT update Customer.email
  2. Homeowner email DOES update Customer.email
  3. Unknown-owner email escalates (NOT auto-applied)
  4. Adjuster phone does NOT update Customer.phone

Strategy:
  - Talk to the API just like /scripts/test-radar-p0.py does.
  - For each test, create a fresh test Customer + Document row directly in SQLite
    (with a known extractedData payload), then POST /api/insights to trigger the
    radar, then read the Customer row back and assert the field is/isn't set.

  - Each test customer is created with a unique name prefix so dedup doesn't
    interfere across runs.
"""
import urllib.request, json, time, sqlite3, sys, os, secrets

BASE = 'http://localhost:3000'
DB_PATH = '/home/z/my-project/db/custom.db'
PASS = 0
FAIL = 0

# Unique run ID so re-running the script doesn't trip on leftover data
RUN_ID = secrets.token_hex(4)
print(f"\nRun ID: {RUN_ID}")


def test(name, condition, detail=''):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name} — {detail}")


def fetch(path, method='GET', body=None):
    req = urllib.request.Request(f'{BASE}{path}', method=method)
    if body is not None:
        req.data = json.dumps(body).encode()
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def db_exec(sql, args=()):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(sql, args)
    conn.commit()
    last = c.lastrowid
    conn.close()
    return last


def db_query(sql, args=()):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(sql, args)
    result = c.fetchall()
    conn.close()
    return result


# Lookup the demo contractor (the API auto-auths as this one in demo mode)
contractor = db_query("SELECT id FROM Contractor WHERE status = 'active' LIMIT 1")
if not contractor:
    print("ERROR: No active contractor found — start the dev server with JOBROLO_DEMO=1 first.")
    sys.exit(2)
CONTRACTOR_ID = contractor[0][0]
print(f"Using contractor: {CONTRACTOR_ID}")


def make_customer(name, email=None, phone=None, address=None):
    """Insert a fresh test customer and return its id."""
    cid = f"test_{RUN_ID}_{secrets.token_hex(6)}"
    db_exec(
        "INSERT INTO Customer (id, contractorId, name, email, phone, address, createdAt, updatedAt) "
        "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
        (cid, CONTRACTOR_ID, name, email, phone, address),
    )
    return cid


def make_doc(customer_id, original_name, extracted_data):
    """Insert a reviewed Document row tied to a customer with the given extractedData JSON."""
    did = f"testdoc_{RUN_ID}_{secrets.token_hex(6)}"
    db_exec(
        "INSERT INTO Document (id, contractorId, filename, originalName, mimeType, size, filePath, "
        "fileType, status, extractedData, customerId, createdAt) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        (
            did, CONTRACTOR_ID, original_name, original_name,
            'application/pdf', 1024, f'/tmp/{original_name}',
            'estimate', 'reviewed', json.dumps(extracted_data), customer_id,
        ),
    )
    return did


def get_customer(cid):
    rows = db_query(
        "SELECT email, phone, address FROM Customer WHERE id = ?", (cid,)
    )
    if not rows:
        return None
    return {'email': rows[0][0], 'phone': rows[0][1], 'address': rows[0][2]}


def cleanup(run_id):
    """Remove all test rows for this run."""
    db_exec("DELETE FROM Insight WHERE title LIKE ?", (f'%[run-{run_id}]%',))
    db_exec("DELETE FROM ContractorMemory WHERE content LIKE ?", (f'%[run-{run_id}]%',))
    db_exec("DELETE FROM Document WHERE id LIKE ?", (f'testdoc_{run_id}_%',))
    db_exec("DELETE FROM Customer WHERE id LIKE ?", (f'test_{run_id}_%',))


def run_radar():
    """Trigger a radar scan and return the summary."""
    return fetch('/api/insights', 'POST')


def dismiss_all_active_insights():
    """Make sure no stale active insights trip the 'already exists' check."""
    insights = fetch('/api/insights')['insights']
    for ins in insights:
        if ins['status'] == 'active':
            try:
                fetch('/api/insights', 'PATCH', {'insightId': ins['id'], 'status': 'dismissed'})
            except Exception:
                pass


# ─── SETUP ─────────────────────────────────────────────────────────────────
print("\n=== SETUP: cleanup any previous test data ===")
cleanup(RUN_ID)
dismiss_all_active_insights()

# Wipe insights so the radar will actually re-investigate our test customers
db_exec("DELETE FROM Insight WHERE source = 'customer'")

# ─── TEST 1: Adjuster email does NOT update Customer.email ─────────────────
print("\n=== TEST 1: Adjuster email does NOT update Customer.email ===")
cid1 = make_customer(f"[run-{RUN_ID}] Adjuster-Only Customer", email=None, phone=None, address=None)
make_doc(
    cid1,
    f"[run-{RUN_ID}] adjuster_only.pdf",
    {
        "claimInfo": {
            "claimNumber": "CLM-TEST-1",
            "carrier": "State Farm",
            "adjusterName": "Mark Thompson",
            "adjusterEmail": "mthompson@statefarm.com",
            "adjusterPhone": "(555) 999-1234",
            "property": "142 Maple Street, Springfield, IL 62701",
        },
        # NOTE: customer sub-object intentionally has NO email/phone — only
        # adjuster info is present. Radar must NOT pull adjuster email into
        # Customer.email.
        "customer": {
            "name": f"[run-{RUN_ID}] Adjuster-Only Customer",
        },
    },
)
print(f"  Created customer {cid1[:18]}... with no email/phone")
print(f"  Created doc with claimInfo.adjusterEmail=mthompson@statefarm.com")

run_radar()
time.sleep(0.5)
cust1 = get_customer(cid1)
print(f"  After radar: email={cust1['email']!r}, phone={cust1['phone']!r}")

test(
    "Customer.email is still NULL (adjuster email NOT applied)",
    cust1['email'] is None or cust1['email'] == '',
    f"email was set to {cust1['email']!r} — BUG: adjuster email leaked into Customer.email",
)
test(
    "Customer.phone is still NULL (adjuster phone NOT applied)",
    cust1['phone'] is None or cust1['phone'] == '',
    f"phone was set to {cust1['phone']!r} — BUG: adjuster phone leaked into Customer.phone",
)

# ─── TEST 2: Homeowner email DOES update Customer.email ────────────────────
print("\n=== TEST 2: Homeowner email DOES update Customer.email ===")
cid2 = make_customer(f"[run-{RUN_ID}] Homeowner Customer", email=None, phone=None, address=None)
make_doc(
    cid2,
    f"[run-{RUN_ID}] homeowner.pdf",
    {
        "claimInfo": {
            "claimNumber": "CLM-TEST-2",
            "carrier": "Allstate",
            "adjusterEmail": "jdoe@allstate.com",  # adjuster email — must NOT be applied
            "adjusterPhone": "(555) 888-7777",
        },
        # Customer sub-object carries a DIFFERENT email — this one is the
        # homeowner's own email and SHOULD be applied to Customer.email.
        "customer": {
            "name": f"[run-{RUN_ID}] Homeowner Customer",
            "email": "homeowner.jane@example.com",
            "phone": "(555) 111-2222",
        },
    },
)
print(f"  Created customer {cid2[:18]}... with no email/phone")
print(f"  Created doc with customer.email=homeowner.jane@example.com (homeowner-owned)")

run_radar()
time.sleep(0.5)
cust2 = get_customer(cid2)
print(f"  After radar: email={cust2['email']!r}, phone={cust2['phone']!r}")

test(
    "Customer.email IS set to the homeowner email",
    cust2['email'] == 'homeowner.jane@example.com',
    f"email was {cust2['email']!r}, expected 'homeowner.jane@example.com'",
)
test(
    "Customer.email is NOT the adjuster email",
    cust2['email'] != 'jdoe@allstate.com',
    f"email was {cust2['email']!r} — BUG: adjuster email won over homeowner email",
)
test(
    "Customer.phone IS set to the homeowner phone",
    cust2['phone'] == '(555) 111-2222',
    f"phone was {cust2['phone']!r}, expected '(555) 111-2222'",
)

# ─── TEST 3: Unknown-owner email escalates ─────────────────────────────────
print("\n=== TEST 3: Unknown-owner email escalates (NOT auto-applied) ===")
cid3 = make_customer(f"[run-{RUN_ID}] Unknown Customer", email=None, phone=None, address=None)
make_doc(
    cid3,
    f"[run-{RUN_ID}] unknown.pdf",
    {
        # Bare `email` key at the root with no entity prefix — owner=unknown.
        # Radar must NOT write this to Customer.email; it must escalate.
        "email": "mystery@example.com",
        "phone": "(555) 000-0000",
        # No claimInfo, no customer sub-object, no adjuster/carrier prefix
    },
)
print(f"  Created customer {cid3[:18]}... with no email/phone")
print(f"  Created doc with bare data.email=mystery@example.com (owner=unknown)")

run_radar()
time.sleep(0.5)
cust3 = get_customer(cid3)
print(f"  After radar: email={cust3['email']!r}, phone={cust3['phone']!r}")

test(
    "Customer.email is still NULL (unknown-owner email NOT auto-applied)",
    cust3['email'] is None or cust3['email'] == '',
    f"email was set to {cust3['email']!r} — BUG: unknown-owner email was auto-applied",
)
test(
    "Customer.phone is still NULL (unknown-owner phone NOT auto-applied)",
    cust3['phone'] is None or cust3['phone'] == '',
    f"phone was set to {cust3['phone']!r} — BUG: unknown-owner phone was auto-applied",
)

# Check that an insight was created and escalated (not 'handled')
unknown_insights = db_query(
    "SELECT id, title, status, resolutionDetail FROM Insight "
    "WHERE source = 'customer' AND sourceId = ? AND title LIKE ?",
    (cid3, f'%[run-{RUN_ID}] Unknown%'),
)
print(f"  Insights for unknown-owner customer: {len(unknown_insights)}")
if unknown_insights:
    status = unknown_insights[0][2]
    detail = unknown_insights[0][3] or ''
    print(f"  Insight status: {status}")
    print(f"  Resolution detail: {detail[:120]}")
    test(
        "Insight was escalated (status != 'handled')",
        status != 'handled',
        f"status was '{status}' — BUG: radar claimed to handle unknown-owner email",
    )
    test(
        "Escalation detail mentions unknown ownership",
        'unknown' in detail.lower() or 'review' in detail.lower() or 'could not determine' in detail.lower(),
        f"detail was: {detail[:120]}",
    )
else:
    test("Insight was created for unknown-owner customer", False, "no insight found")

# ─── TEST 4: Customer phone does not use adjusterPhone ─────────────────────
print("\n=== TEST 4: Customer phone does NOT use claimInfo.adjusterPhone ===")
cid4 = make_customer(f"[run-{RUN_ID}] Phone-Only Adjuster Customer", email=None, phone=None, address=None)
make_doc(
    cid4,
    f"[run-{RUN_ID}] adjuster_phone_only.pdf",
    {
        "claimInfo": {
            "claimNumber": "CLM-TEST-4",
            "carrier": "USAA",
            "adjusterName": "Sarah Lee",
            "adjusterPhone": "(555) 444-5555",  # adjuster phone — must NOT be applied
            "adjusterEmail": "slee@usaa.com",
        },
        # customer sub-object has NO phone — only name
        "customer": {
            "name": f"[run-{RUN_ID}] Phone-Only Adjuster Customer",
        },
    },
)
print(f"  Created customer {cid4[:18]}... with no phone")
print(f"  Created doc with claimInfo.adjusterPhone=(555) 444-5555 (adjuster-owned)")

run_radar()
time.sleep(0.5)
cust4 = get_customer(cid4)
print(f"  After radar: phone={cust4['phone']!r}, email={cust4['email']!r}")

test(
    "Customer.phone is still NULL (adjuster phone NOT applied)",
    cust4['phone'] is None or cust4['phone'] == '',
    f"phone was set to {cust4['phone']!r} — BUG: adjuster phone leaked into Customer.phone",
)
test(
    "Customer.email is still NULL (adjuster email NOT applied)",
    cust4['email'] is None or cust4['email'] == '',
    f"email was set to {cust4['email']!r} — BUG: adjuster email leaked into Customer.email",
)

# ─── BONUS TEST 5: Extractor put adjuster email in customer.email — radar must still reject ─
print("\n=== TEST 5: customer.email == claimInfo.adjusterEmail → still rejected ===")
cid5 = make_customer(f"[run-{RUN_ID}] Cross-Check Customer", email=None, phone=None, address=None)
make_doc(
    cid5,
    f"[run-{RUN_ID}] cross_check.pdf",
    {
        "claimInfo": {
            "claimNumber": "CLM-TEST-5",
            "carrier": "Farmers",
            "adjusterEmail": "parker@farmers.com",
            "adjusterPhone": "(555) 333-2222",
        },
        # The extractor incorrectly copied the adjuster email/phone into the
        # customer sub-object. Radar must detect the value match and demote
        # the customer.* candidate to 'adjuster'.
        "customer": {
            "name": f"[run-{RUN_ID}] Cross-Check Customer",
            "email": "parker@farmers.com",     # same as adjusterEmail — must be rejected
            "phone": "(555) 333-2222",          # same as adjusterPhone — must be rejected
            "address": "999 Real Customer Addr, Hometown",  # legitimate homeowner address — OK
        },
    },
)
print(f"  Created customer {cid5[:18]}... with no email/phone/address")
print(f"  Created doc where customer.email == claimInfo.adjusterEmail (extractor bug)")

run_radar()
time.sleep(0.5)
cust5 = get_customer(cid5)
print(f"  After radar: email={cust5['email']!r}, phone={cust5['phone']!r}, address={cust5['address']!r}")

test(
    "Customer.email NOT poisoned even when extractor put adjuster email in customer sub-object",
    cust5['email'] is None or cust5['email'] == '',
    f"email was set to {cust5['email']!r} — BUG: cross-check failed to detect adjuster email in customer sub-object",
)
test(
    "Customer.phone NOT poisoned even when extractor put adjuster phone in customer sub-object",
    cust5['phone'] is None or cust5['phone'] == '',
    f"phone was set to {cust5['phone']!r} — BUG: cross-check failed",
)
test(
    "Customer.address IS set (legitimate homeowner address from customer sub-object)",
    cust5['address'] == '999 Real Customer Addr, Hometown',
    f"address was {cust5['address']!r}",
)

# ─── CLEANUP ───────────────────────────────────────────────────────────────
print("\n=== CLEANUP ===")
cleanup(RUN_ID)
print(f"  Removed all test customers, docs, insights, and memories for run {RUN_ID}")

# ─── SUMMARY ───────────────────────────────────────────────────────────────
print(f"\n{'='*70}")
print(f"ENTITY CLASSIFICATION RESULTS: {PASS} passed, {FAIL} failed")
print(f"{'='*70}")
sys.exit(0 if FAIL == 0 else 1)
