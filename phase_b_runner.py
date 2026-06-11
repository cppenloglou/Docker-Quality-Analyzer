#!/usr/bin/env python3
"""
Phase B runner — Docker Quality Analyzer
Υποβάλλει όλα τα αρχεία του dataset στην τοπική πλατφόρμα και αποθηκεύει τα αποτελέσματα.

ΠΡΟΣΑΡΜΟΣΕ τα σημεία με  # <-- CHECK  σύμφωνα με το /openapi.json (swagger) της εφαρμογής σου.
Εκτέλεση:  python3 phase_b_runner.py /path/to/dataset
"""
import json, sys, time, mimetypes
from pathlib import Path
import urllib.request

BASE = "http://localhost:8000"            # <-- CHECK: base URL του backend (ή μέσω nginx)
EMAIL, PASSWORD = "phaseb@example.com", "PhaseB-2026!"
ANALYZE = {
    "dockerfile": f"{BASE}/api/v1/dockerfile/analyze",
    "compose":    f"{BASE}/api/v1/compose/analyze",
}
JOB_STATUS = f"{BASE}/api/v1/users/me/jobs/{{job_id}}"   # GET job + result (history router)
POLL_SEC, POLL_MAX = 2, 90

def http(method, url, data=None, headers=None, raw=False):
    body = data if raw else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    if not raw and data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def multipart(url, token, filepath: Path, field="file"):     # <-- CHECK: όνομα πεδίου αρχείου
    boundary = "----phaseb"
    content = filepath.read_bytes()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; "
            f"filename=\"{filepath.name}\"\r\nContent-Type: text/plain\r\n\r\n").encode() \
           + content + f"\r\n--{boundary}--\r\n".encode()
    return http("POST", url, data=body, raw=True, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    })

def get_token():
    try:
        http("POST", f"{BASE}/auth/register", {"email": EMAIL, "password": PASSWORD})
    except Exception:
        pass  # ήδη εγγεγραμμένος
    resp = http("POST", f"{BASE}/auth/login", {"email": EMAIL, "password": PASSWORD})
    return resp.get("access_token") or resp.get("token") or resp["accessToken"]  # <-- CHECK

def wait_for_result(token, job_id):
    for _ in range(POLL_MAX):
        j = http("GET", JOB_STATUS.format(job_id=job_id),
                 headers={"Authorization": f"Bearer {token}"})
        status = (j.get("status") or "").lower()
        if status in ("done", "completed"):
            return j.get("result", j)
        if status == "failed":
            return {"_failed": True, **j}
        time.sleep(POLL_SEC)
    return {"_timeout": True}

def main(dataset_dir):
    out = Path("phase_b_results"); out.mkdir(exist_ok=True)
    token = get_token()
    files = [("dockerfile", p) for p in sorted(Path(dataset_dir, "dockerfiles").glob("*"))] + \
            [("compose",    p) for p in sorted(Path(dataset_dir, "compose").glob("*"))]
    summary = []
    for i, (ftype, path) in enumerate(files, 1):
        try:
            resp = multipart(ANALYZE[ftype], token, path)
            job_id = resp.get("job_id") or resp.get("id")
            result = wait_for_result(token, job_id) if job_id else resp
            (out / f"{path.stem}__{ftype}.json").write_text(
                json.dumps({"file": path.name, "type": ftype, "result": result},
                           ensure_ascii=False, indent=2))
            score = result.get("score"); grade = result.get("grade")
            ok = "FAILED" if result.get("_failed") or result.get("_timeout") else "ok"
            summary.append((path.name, ftype, ok, score, grade))
            print(f"[{i}/{len(files)}] {path.name}: {ok} score={score} grade={grade}")
        except Exception as e:
            summary.append((path.name, ftype, f"ERROR {e}", None, None))
            print(f"[{i}/{len(files)}] {path.name}: ERROR {e}")
    with open(out / "_summary.csv", "w") as f:
        f.write("file,type,status,score,grade\n")
        for row in summary:
            f.write(",".join(str(x) for x in row) + "\n")
    print(f"\nΈτοιμο. Αποτελέσματα στο {out}/ — τρέξε μετά το phase_b_aggregate.py")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dataset")
