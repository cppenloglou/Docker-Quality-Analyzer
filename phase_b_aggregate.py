#!/usr/bin/env python3
"""
Phase B aggregator v2 — διορθωμένη ανίχνευση runnability βάσει meta.runnability.rules.
Εκτέλεση:  python3 phase_b_aggregate_v2.py phase_b_results/
Παράγει:  phase_b_stats_final.md
"""
import json, sys, re
from pathlib import Path
from collections import Counter

RULE_LABELS = {
    "has_services": "Απουσία services",
    "no_build_contexts": "Build context (απαιτεί αρχεία project)",
    "no_bind_mounts": "Bind mounts προς τον host",
    "no_env_file": "Εξάρτηση από env_file",
    "no_unresolved_env": "Μη επιλυμένες μεταβλητές ${VAR}",
    "no_external_resources": "External volumes/networks",
    "explicit_non_latest_images": "Image χωρίς ρητό non-latest tag",
    "no_dangerous_runtime_flags": "Επικίνδυνες runtime επιλογές (privileged/host net/cap_add/devices)",
}

REASON_PATTERNS = [
    ("build context", "Build context"),
    ("missing an image reference", "Απουσία image reference"),
    ("non-latest explicit tag", "Μη σταθερό image tag"),
    ("env_file", "Εξάρτηση από env_file"),
    ("bind mount", "Bind mount"),
    ("privileged", "Privileged mode"),
    ("host network", "Host network mode"),
    ("cap_add", "cap_add"),
    ("device", "Device mappings"),
    ("external=true", "External volume/network"),
    ("unresolved", "Μη επιλυμένες ${VAR}"),
]

def load(results_dir):
    rows = []
    for p in sorted(Path(results_dir).glob("*.json")):
        d = json.loads(p.read_text())
        r = d.get("result", {})
        if r.get("_failed") or r.get("_timeout"):
            rows.append({"file": d["file"], "type": d["type"], "ok": False}); continue
        issues = (r.get("errors", []) + r.get("warnings", []) +
                  r.get("suggestions", []) + r.get("securityIssues", []))
        runnab = (r.get("meta", {}) or {}).get("runnability") or {}
        rules = runnab.get("rules") or {}
        rows.append({
            "file": d["file"], "type": d["type"], "ok": True,
            "score": r.get("score"), "grade": r.get("grade"),
            "codes": [i.get("code") for i in issues],
            "sec_msgs": [i.get("message", "") for i in r.get("securityIssues", [])],
            "rules": rules,
            "reasons": runnab.get("reasons") or [],
            "runnable": bool(rules) and all(rules.values()),
        })
    return rows

def pct(a, b): return f"{a}/{b} ({100*a/b:.1f}%)" if b else "—"

def main(results_dir):
    rows = load(results_dir)
    done = [r for r in rows if r["ok"]]
    dfs  = [r for r in done if r["type"] == "dockerfile"]
    cps  = [r for r in done if r["type"] == "compose"]
    out = []
    out.append("# Στατιστικά Φάσης Β (τελικά)\n")
    out.append(f"- Σύνολο artifacts: {len(rows)} | Ολοκληρωμένες αναλύσεις: {pct(len(done), len(rows))}")
    out.append(f"- Dockerfiles: {len(dfs)} | Compose: {len(cps)}\n")

    out.append("## Κατανομή βαθμίδων\n")
    out.append("| Τύπος | A | B | C | D | F | Μέσο score |")
    out.append("|---|---|---|---|---|---|---|")
    for label, grp in (("Dockerfile", dfs), ("Compose", cps), ("Σύνολο", done)):
        g = Counter(r["grade"] for r in grp)
        avg = sum(r["score"] for r in grp) / len(grp) if grp else 0
        out.append(f"| {label} | {g.get('A',0)} | {g.get('B',0)} | {g.get('C',0)} | "
                   f"{g.get('D',0)} | {g.get('F',0)} | {avg:.1f} |")

    out.append("\n## Συχνότεροι κωδικοί ευρημάτων (Top 12)\n")
    out.append("| Κωδικός | Εμφανίσεις | Αρχεία με ≥1 |")
    out.append("|---|---|---|")
    code_total = Counter(); code_files = Counter()
    for r in done:
        cc = Counter(r["codes"]); code_total.update(cc)
        for c in cc: code_files[c] += 1
    for code, n in code_total.most_common(12):
        out.append(f"| {code} | {n} | {pct(code_files[code], len(done))} |")

    out.append("\n## Επιπολασμός βασικών προβλημάτων\n")
    def has(r, code): return code in r["codes"]
    def sec_kw(r, kw): return any(kw in m.lower() for m in r["sec_msgs"])
    out.append(f"- Dockerfiles με :latest base image (DL3007): {pct(sum(has(r,'DL3007') for r in dfs), len(dfs))}")
    out.append(f"- Dockerfiles χωρίς οδηγία USER (SEC002): {pct(sum(has(r,'SEC002') for r in dfs), len(dfs))}")
    out.append(f"- Dockerfiles με unpinned εξαρτήσεις (DL3008/DL3013/DL3016/DL3018): "
               f"{pct(sum(any(has(r,c) for c in ('DL3008','DL3013','DL3016','DL3018')) for r in dfs), len(dfs))}")
    out.append(f"- Αρχεία με security finding secret/password: {pct(sum(sec_kw(r,'secret') or sec_kw(r,'password') for r in done), len(done))}")
    out.append(f"- Compose με image χωρίς ρητό tag: {pct(sum(has(r,'service-image-require-explicit-tag') for r in cps), len(cps))}")
    out.append(f"- Αρχεία με DL1000 (αποτυχία parsing Hadolint): {pct(sum(has(r,'DL1000') for r in dfs), len(dfs))}")

    out.append("\n## Runnability (Compose)\n")
    with_rules = [r for r in cps if r["rules"]]
    runnable = [r for r in with_rules if r["runnable"]]
    blocked  = [r for r in with_rules if not r["runnable"]]
    out.append(f"- Με δεδομένα runnability: {len(with_rules)}/{len(cps)}")
    out.append(f"- **Runnable: {pct(len(runnable), len(with_rules))} | Blocked: {pct(len(blocked), len(with_rules))}**\n")

    out.append("### Αποτυχίες ανά κανόνα precheck\n")
    out.append("| Κανόνας | Αρχεία που αποτυγχάνουν | % |")
    out.append("|---|---|---|")
    for rule, label in RULE_LABELS.items():
        fails = sum(1 for r in with_rules if r["rules"].get(rule) is False)
        out.append(f"| {label} | {fails} | {100*fails/len(with_rules):.1f}% |" if with_rules else "| — | — | — |")

    out.append("\n### Κατανομή λόγων αποκλεισμού (από reasons)\n")
    out.append("| Λόγος | Αρχεία |")
    out.append("|---|---|")
    reason_files = Counter()
    for r in blocked:
        seen = set()
        for reason in r["reasons"]:
            for pat, label in REASON_PATTERNS:
                if pat in reason and label not in seen:
                    reason_files[label] += 1; seen.add(label)
    for label, n in reason_files.most_common():
        out.append(f"| {label} | {n} |")

    out.append("\n### Αριθμός αποτυχημένων κανόνων ανά blocked αρχείο\n")
    fail_dist = Counter(sum(1 for v in r["rules"].values() if v is False) for r in blocked)
    out.append("| Αποτυχημένοι κανόνες | Αρχεία |")
    out.append("|---|---|")
    for k in sorted(fail_dist):
        out.append(f"| {k} | {fail_dist[k]} |")

    out.append("\n### Runnable αρχεία (ονομαστικά)\n")
    for r in runnable:
        out.append(f"- {r['file']} (score {r['score']}, grade {r['grade']})")

    Path("phase_b_stats_final.md").write_text("\n".join(out), encoding="utf-8")
    print("\n".join(out))
    print("\nΓράφτηκε: phase_b_stats_final.md")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "phase_b_results")