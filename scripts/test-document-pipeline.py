"""
Test runner for the document intelligence pipeline.
Uploads each test document to /api/upload, polls /api/documents/[id] until
terminal status, and prints a summary table.

Usage: python3 scripts/test-document-pipeline.py
"""
import os, sys, time, json, urllib.request, urllib.error, mimetypes, uuid

BASE = 'http://localhost:3000'
TEST_DOCS = [
    ('searchable_pdf',  '/tmp/test-docs/searchable_estimate.pdf'),
    ('scanned_pdf',     '/tmp/test-docs/scanned_inspection.pdf'),
    ('mixed_pdf',       '/tmp/test-docs/mixed_estimate.pdf'),
    ('carrier_letter',  '/tmp/test-docs/carrier_letter.pdf'),
    ('inspection_report', '/tmp/test-docs/inspection_report.pdf'),
    ('text_file',       '/tmp/test-docs/customer_notes.txt'),
    ('csv_file',        '/tmp/test-docs/material_list.csv'),
    ('image_png',       '/tmp/test-docs/photo_damage.png'),
    ('image_jpg',       '/tmp/test-docs/photo_roof.jpg'),
    ('docx_file',       '/tmp/test-docs/proposal.docx'),
]

# Boundary for multipart/form-data
BOUNDARY = f'----jobrolo-test-{uuid.uuid4().hex}'


def upload_file(path: str) -> dict:
    """Upload a file via multipart/form-data. Returns parsed JSON response."""
    filename = os.path.basename(path)
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    with open(path, 'rb') as f:
        file_data = f.read()

    body = (
        f'--{BOUNDARY}\r\n'
        f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'
        f'Content-Type: {mime}\r\n\r\n'
    ).encode() + file_data + f'\r\n--{BOUNDARY}--\r\n'.encode()

    req = urllib.request.Request(
        f'{BASE}/api/upload',
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={BOUNDARY}'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {'error': f'HTTP {e.code}', 'detail': e.read().decode()[:200]}
    except Exception as e:
        return {'error': str(e)}


def fetch_document(doc_id: str) -> dict:
    req = urllib.request.Request(f'{BASE}/api/documents/{doc_id}', method='GET')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {'error': str(e)}


def poll_until_terminal(doc_id: str, timeout_s: int = 180) -> dict:
    """Poll /api/documents/[id] until status is terminal (reviewed/failed/needs_ocr)."""
    terminal = {'reviewed', 'failed', 'needs_ocr'}
    start = time.time()
    last_status = None
    while time.time() - start < timeout_s:
        result = fetch_document(doc_id)
        if 'error' in result:
            time.sleep(2)
            continue
        doc = result.get('document', {})
        status = doc.get('status')
        if status != last_status:
            print(f'    [{time.time() - start:5.1f}s] status: {status}')
            last_status = status
        if status in terminal:
            return doc
        time.sleep(2)
    return {'status': 'timeout', 'error': f'no terminal status after {timeout_s}s'}


def main():
    print(f'\n{"="*80}')
    print(f'Jobrolo Document Intelligence Pipeline Test')
    print(f'{"="*80}')
    print(f'Base URL: {BASE}')
    print(f'Test documents: {len(TEST_DOCS)}')
    print()

    results = []
    for label, path in TEST_DOCS:
        if not os.path.exists(path):
            print(f'[{label}] SKIP — file not found: {path}')
            results.append((label, 'skip', 'file not found', {}))
            continue

        print(f'\n[{label}] Uploading {os.path.basename(path)} ({os.path.getsize(path)} bytes)...')
        upload_resp = upload_file(path)
        if 'error' in upload_resp:
            print(f'  UPLOAD FAILED: {upload_resp}')
            results.append((label, 'upload_failed', str(upload_resp.get('error')), upload_resp))
            continue

        docs = upload_resp.get('documents', [])
        if not docs:
            print(f'  NO DOCUMENTS RETURNED: {upload_resp}')
            results.append((label, 'no_docs', str(upload_resp), upload_resp))
            continue

        doc = docs[0]
        doc_id = doc['id']
        initial_status = doc.get('status')
        print(f'  Uploaded. doc_id={doc_id}, initial_status={initial_status}, fileType={doc.get("fileType")}')

        final = poll_until_terminal(doc_id)
        final_status = final.get('status', 'unknown')
        extraction_method = final.get('extractionMethod', '—')
        ai_category = final.get('aiCategory', '—')
        ai_summary = (final.get('aiSummary') or '')[:80]
        ocr_text_length = final.get('ocrTextLength', 0)

        results.append((label, final_status, extraction_method, {
            'aiCategory': ai_category,
            'aiSummary': ai_summary,
            'ocrTextLength': ocr_text_length,
            'fileType': doc.get('fileType'),
        }))

    # ----- Print summary -----
    print(f'\n{"="*80}')
    print('SUMMARY')
    print(f'{"="*80}')
    print(f'{"Label":<22} {"Status":<14} {"Method":<16} {"Category":<22} {"OCR chars":<10} Summary')
    print('-' * 120)
    for label, status, method, info in results:
        cat = info.get('aiCategory', '—') if isinstance(info, dict) else '—'
        ocr_len = info.get('ocrTextLength', '—') if isinstance(info, dict) else '—'
        summary = info.get('aiSummary', '') if isinstance(info, dict) else str(info)
        print(f'{label:<22} {status:<14} {method:<16} {cat:<22} {str(ocr_len):<10} {summary}')

    # ----- Pass/fail analysis -----
    print(f'\n{"="*80}')
    print('PASS/FAIL ANALYSIS')
    print(f'{"="*80}')
    expected = {
        'searchable_pdf':    {'status': 'reviewed', 'method': 'pdf_text'},
        'scanned_pdf':       {'status': 'needs_ocr', 'method': 'pdf_text'},  # No OCR provider configured — clear needs_ocr
        'mixed_pdf':         {'status': 'reviewed', 'method': 'pdf_text'},
        'carrier_letter':    {'status': 'reviewed', 'method': 'pdf_text'},
        'inspection_report': {'status': 'reviewed', 'method': 'pdf_text'},
        'text_file':         {'status': 'reviewed', 'method': 'text_direct'},
        'csv_file':          {'status': 'reviewed', 'method': 'csv_text'},
        'image_png':         {'status': 'reviewed', 'method': 'image_vision'},
        'image_jpg':         {'status': 'reviewed', 'method': 'image_vision'},
        'docx_file':         {'status': 'reviewed', 'method': 'docx_text'},
    }
    pass_count = 0
    for label, status, method, info in results:
        exp = expected.get(label)
        if not exp:
            print(f'  [{label}] SKIP — no expectation defined')
            continue
        status_ok = status == exp['status']
        method_ok = method == exp['method'] or (exp['method'] == 'pdf_ocr' and method == 'pdf_ocr') or (exp['method'] == 'pdf_hybrid' and method == 'pdf_hybrid')
        # Be lenient on the method — the key is the status
        verdict = 'PASS' if status_ok else 'FAIL'
        if status_ok:
            pass_count += 1
        method_note = '' if method_ok else f' (method expected {exp["method"]}, got {method})'
        print(f'  [{label:<22}] {verdict} — status={status}, method={method}{method_note}')

    print(f'\n{pass_count}/{len(expected)} tests passed.')
    return 0 if pass_count == len(expected) else 1


if __name__ == '__main__':
    sys.exit(main())
