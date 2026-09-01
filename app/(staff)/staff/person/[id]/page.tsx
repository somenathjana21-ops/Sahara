// app/(staff)/staff/person/[id]/page.tsx — Person detail with trend and breakdown
// Fetches from /api/staff/person/[id] so audit_events are written (CHECKS_TM3 T3-A7, T3-C6)
// S5 acoustic is greyed out with caveat (AGENTS.md invariant 2)

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TierBadge } from '@/components/ui/TierBadge';
import { Card } from '@/components/ui/Card';
import type { Tier } from '@/types/contract';

/** Signal labels for the component breakdown */
const SIGNAL_LABELS: Record<string, string> = {
  s1: 'S1 — Self-report',
  s2: 'S2 — NLP sentiment',
  s3: 'S3 — Case-file',
  s4: 'S4 — Temporal',
  s5: 'S5 — Acoustic',
};

interface PersonDetail {
  person: {
    id: string;
    pseudonym: string;
    language: string;
    baseline_mean: number | null;
    baseline_var: number | null;
    checkin_count: number;
  };
  case: {
    atrocity_category: string;
    stage: string;
    next_hearing_date: string | null;
    adjournment_count: number;
    bail_status: string;
    relief_due_date: string | null;
    relief_paid: boolean;
    last_intimidation_report: string | null;
  };
  assessments: Array<{
    id: string;
    composite: number;
    z_score: number | null;
    change_point: boolean;
    tier: Tier;
    components: Record<string, number | null>;
    contributions: Record<string, number | null>;
    explanation: string[];
    created_at: string;
  }>;
  alerts: Array<{
    id: string;
    tier: Tier;
    created_at: string;
    acked_at: string | null;
  }>;
}

export default function PersonDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPerson() {
      try {
        const res = await fetch(`/api/staff/person/${id}`, {
          credentials: 'include',
        });
        if (res.status === 404) {
          setError('Person not found');
          return;
        }
        if (!res.ok) {
          setError(`Failed to load person (${res.status})`);
          return;
        }
        const data: PersonDetail = await res.json();
        setDetail(data);
      } catch {
        setError('Failed to load person');
      } finally {
        setLoading(false);
      }
    }
    fetchPerson();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-8 text-center text-ink-soft">
        Loading…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-6xl mx-auto p-8 text-center text-red-700">
        {error || 'Person not found'}
      </div>
    );
  }

  const { person, case: caseData, assessments, alerts } = detail;
  const latest = assessments.length > 0 ? assessments[assessments.length - 1] : null;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-semibold">{person.pseudonym}</h1>
          {latest && <TierBadge tier={latest.tier} />}
        </div>
        <p className="text-sm text-ink-soft mt-1">
          Language: {person.language === 'hi' ? 'Hindi' : 'English'} •{' '}
          {person.checkin_count} check-ins • Baseline: μ={person.baseline_mean?.toFixed(2) || 'N/A'}
        </p>
      </div>

      {/* Latest Assessment */}
      {latest && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Latest Assessment</h2>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <p className="text-sm text-ink-soft">Composite Score</p>
              <p className="text-3xl font-semibold">{latest.composite.toFixed(1)}</p>
            </div>
            <div>
              <p className="text-sm text-ink-soft">Z-Score</p>
              <p className="text-3xl font-semibold">
                {latest.z_score?.toFixed(2) || 'N/A'}
              </p>
            </div>
          </div>

          {/* Component Breakdown — S5 acoustic greyed out with caveat */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Component Breakdown</h3>
            {Object.entries(latest.contributions).map(([key, value]) => {
              const component = latest.components[key];
              const isAcoustic = key === 's5';

              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 ${isAcoustic ? 'opacity-50' : ''}`}
                >
                  <span className="text-xs font-mono uppercase w-8">{key}</span>
                  <div className="flex-1 bg-line h-8 rounded relative overflow-hidden">
                    {value !== null && !isAcoustic && (
                      <div
                        className="bg-accent h-full"
                        style={{ width: `${value}%` }}
                      />
                    )}
                    {isAcoustic && component !== null && (
                      <div
                        className="bg-line h-full"
                        style={{ width: `${component}%` }}
                      />
                    )}
                  </div>
                  <span className="text-sm w-48 text-right">
                    {isAcoustic ? (
                      <span className="italic text-ink-soft">
                        {component !== null ? component : 'N/A'}
                        {' — '}Low confidence. Not used in scoring.
                      </span>
                    ) : (
                      <>
                        {value !== null ? value.toFixed(1) : 'N/A'}
                        {component !== null && (
                          <span className="text-ink-soft ml-1">({component})</span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Explanation */}
          {latest.explanation && Array.isArray(latest.explanation) && latest.explanation.length > 0 && (
            <div className="mt-4 pt-4 border-t border-line">
              <h3 className="font-semibold text-sm mb-2">Context</h3>
              <ul className="text-sm space-y-1">
                {latest.explanation.map((line, i) => (
                  <li key={i} className="text-ink-soft">• {line}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Case Context (S3 source) */}
      {caseData && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Case Context (S3 Signal Source)</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-ink-soft">Category</p>
              <p className="font-medium">{caseData.atrocity_category}</p>
            </div>
            <div>
              <p className="text-ink-soft">Stage</p>
              <p className="font-medium capitalize">{caseData.stage}</p>
            </div>
            <div>
              <p className="text-ink-soft">Next Hearing</p>
              <p className="font-medium">
                {caseData.next_hearing_date || 'Not scheduled'}
              </p>
            </div>
            <div>
              <p className="text-ink-soft">Adjournments</p>
              <p className="font-medium">{caseData.adjournment_count}</p>
            </div>
            <div>
              <p className="text-ink-soft">Bail Status</p>
              <p className="font-medium">{caseData.bail_status.replace('_', ' ')}</p>
            </div>
            <div>
              <p className="text-ink-soft">Relief Status</p>
              <p className="font-medium">
                {caseData.relief_paid ? 'Paid' :
                 caseData.relief_due_date ? `Due ${caseData.relief_due_date}` :
                 'N/A'}
              </p>
            </div>
            {caseData.last_intimidation_report && (
              <div className="col-span-2">
                <p className="text-ink-soft">Last Intimidation Report</p>
                <p className="font-medium text-red-700">{caseData.last_intimidation_report}</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Trend History — skip null-component / composite-0 assessments (AGENTS.md invariant 5) */}
      {assessments && assessments.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Trend ({assessments.length} assessments)</h2>
          <div className="space-y-3">
            {assessments.map((a, i) => {
              const isNullAssessment =
                a.composite === 0 &&
                Object.values(a.components).every((v) => v === null);

              return (
                <div
                  key={a.id}
                  className={`flex items-center gap-4 text-sm ${isNullAssessment ? 'opacity-40 border-l-2 border-ink-soft pl-2' : ''}`}
                >
                  <span className="text-ink-soft w-12">#{i + 1}</span>
                  <TierBadge tier={a.tier} />
                  <span className="font-mono">
                    {isNullAssessment ? '—' : a.composite.toFixed(1)}
                  </span>
                  {a.change_point && (
                    <span className="text-red-700 font-semibold">↑ Change Point</span>
                  )}
                  <span className="text-ink-soft ml-auto">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Alerts */}
      {alerts && alerts.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Alerts ({alerts.length})</h2>
          <div className="space-y-2 text-sm">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between py-2 border-b border-line last:border-0">
                <div className="flex items-center gap-3">
                  <TierBadge tier={alert.tier} />
                  <span className="text-ink-soft">
                    {new Date(alert.created_at).toLocaleString()}
                  </span>
                </div>
                <span className={alert.acked_at ? 'text-calm' : 'text-red-700 font-semibold'}>
                  {alert.acked_at ? 'Acknowledged' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
