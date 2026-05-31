import { Link } from "react-router-dom";

import { Layout } from "../components/Layout";
import { MotionPage } from "../components/motion";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";

const penaltyRows = [
  { label: "Error finding", weight: 15, note: "Strong penalty for correctness/runtime risks." },
  { label: "Warning finding", weight: 8, note: "Medium penalty for likely maintainability/runtime issues." },
  { label: "Info/suggestion finding", weight: 3, note: "Light penalty for best-practice opportunities." },
  { label: "Security finding", weight: 10, note: "Extra penalty for security-sensitive patterns." },
];

const gradeRows = [
  { grade: "A", range: "90-100" },
  { grade: "B", range: "75-89" },
  { grade: "C", range: "60-74" },
  { grade: "D", range: "45-59" },
  { grade: "F", range: "0-44" },
];

export function ScoringGuide() {
  return (
    <Layout>
      <MotionPage>
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Education</p>
            <h1 className="mt-2 text-3xl font-bold text-white">
              How Docker Quality Analyzer Scoring Works
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">
              This guide explains exactly how score and grade are computed for Dockerfile, Compose,
              and Project workflows, how findings are grouped, and how to interpret results in
              practice.
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Source of truth: backend scoring in <code>AnalysisService</code> and grade mapping in{" "}
              <code>_grade()</code>.
            </p>
          </header>

          <Card className="border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Scoring Formula</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                1) Start at <code>100</code>.
              </p>
              <p>
                2) Compute raw penalty from findings:
                <code className="ml-1">
                  errors*15 + warnings*8 + suggestions*3 + security*10
                </code>
                .
              </p>
              <p>
                3) Apply density factor to avoid over-penalizing very short files:
                <code className="ml-1">min(1.0, 50.0 / line_count)</code>.
              </p>
              <p>
                4) Final score:
                <code className="ml-1">
                  clamp(round(100 - raw_penalty*density_factor), 0, 100)
                </code>
                .
              </p>
              <p>5) Grade is derived from score bands shown below.</p>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-slate-800 bg-slate-900 p-6">
              <h3 className="text-base font-semibold text-white">Penalty Weights</h3>
              <div className="mt-4 space-y-2">
                {penaltyRows.map((row) => (
                  <div
                    key={row.label}
                    className="rounded-lg border border-slate-800 bg-slate-950 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-100">{row.label}</p>
                      <Badge className="border-slate-700 bg-slate-800 text-slate-100">
                        -{row.weight}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{row.note}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-slate-800 bg-slate-900 p-6">
              <h3 className="text-base font-semibold text-white">Grade Bands</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="py-2">Grade</th>
                      <th className="py-2">Score range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradeRows.map((row) => (
                      <tr key={row.grade} className="border-b border-slate-800/70 text-slate-200">
                        <td className="py-2 font-semibold">{row.grade}</td>
                        <td className="py-2 font-mono">{row.range}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card className="border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Workflow Details</h2>
            <div className="mt-4 space-y-4 text-sm text-slate-300">
              <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">A) Dockerfile analysis</h3>
                <p className="mt-2">
                  Input is one Dockerfile. Plugins include Dockerfile lint rules, security scanning,
                  and resource estimation. Output includes categorized findings
                  (errors/warnings/suggestions/securityIssues), score, and grade.
                </p>
                <p className="mt-2">
                  Errors hurt most, warnings are medium, suggestions are light, and security findings
                  add extra penalty. Density factor uses line count to scale penalties.
                </p>
              </section>

              <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">B) Compose analysis</h3>
                <p className="mt-2">
                  Input is one compose file. Plugins include compose validator, compose runnability,
                  security scanning, and resource estimation.
                </p>
                <p className="mt-2">
                  Runnability metadata checks service definitions, image/build declarations, bind mount
                  validity, env/env_file wiring, and suspicious build paths. Score and grade still use
                  finding penalties; runnability metadata is additional context.
                </p>
              </section>

              <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">C) Project analysis</h3>
                <p className="mt-2">
                  Input is a ZIP archive. The system safely scans, analyzes all detected Dockerfiles
                  and Compose files, builds detected Dockerfile images automatically, then merges
                  per-file outputs into project summary structures.
                </p>
                <p className="mt-2">
                  Project overall score is currently the average of per-file scores, and grade is
                  mapped from that average. Build results and service mappings add operational context.
                  Compose runtime/deploy remains an explicit manual action.
                </p>
              </section>
            </div>
          </Card>

          <Card className="border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Worked Examples</h2>
            <div className="mt-4 space-y-4 text-sm text-slate-300">
              <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">Example 1: Small Dockerfile</h3>
                <p className="mt-2">
                  25 lines, 1 error, 1 warning, 0 suggestions, 0 security findings.
                </p>
                <p className="mt-1 font-mono text-xs text-slate-300">
                  raw_penalty = 1*15 + 1*8 = 23, density=min(1,50/25)=1, score=100-23=77, grade=B
                </p>
              </section>

              <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">Example 2: Compose with runnability issues</h3>
                <p className="mt-2">
                  80 lines, 1 warning for invalid bind mount + 1 security issue for risky secret
                  pattern.
                </p>
                <p className="mt-1 font-mono text-xs text-slate-300">
                  raw_penalty = 1*8 + 1*10 = 18, density=min(1,50/80)=0.625, score=round(100-11.25)=89, grade=B
                </p>
                <p className="mt-2">
                  Even with a strong score, runnability notes can still block deployment until fixed.
                </p>
              </section>

              <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <h3 className="font-semibold text-white">Example 3: Project ZIP with mixed quality</h3>
                <p className="mt-2">
                  Per-file scores: Dockerfile A=92, Compose B=68, Dockerfile C=41.
                </p>
                <p className="mt-1 font-mono text-xs text-slate-300">
                  overall_score = round((92+68+41)/3) = 67, overall_grade = C
                </p>
                <p className="mt-2">
                  One poor file can significantly pull down project quality even if others are strong.
                </p>
              </section>
            </div>
          </Card>

          <Card className="border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Transparency Notes</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>The analyzer is a quality assistant, not a production guarantee.</li>
              <li>A high score does not prove full security or runtime success.</li>
              <li>A low score highlights areas that deserve review and remediation.</li>
              <li>
                Runtime can still fail due to app bugs, missing env vars, unavailable services, port
                conflicts, or missing files.
              </li>
              <li>Compose runtime is always manual and user-triggered.</li>
              <li>
                Research analytics use anonymized aggregates and do not expose user source files or
                raw private metadata.
              </li>
            </ul>
            <div className="mt-4 text-sm">
              <Link to="/research" className="text-sky-400 underline-offset-2 hover:underline">
                Back to Research Dashboard
              </Link>
            </div>
          </Card>
        </div>
      </MotionPage>
    </Layout>
  );
}
