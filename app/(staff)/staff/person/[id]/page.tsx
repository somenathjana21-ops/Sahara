// app/(staff)/staff/person/[id]/page.tsx — Person detail with trend and breakdown

import { createClient } from '@supabase/supabase-js';
import { TierBadge } from '@/components/ui/TierBadge';
import { Card } from '@/components/ui/Card';
import { notFound } from 'next/navigation';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch person
  const { data: person } = await supabase
    .from('persons')
    .select('*')
    .eq('id', id)
    .single();

  if (!person) notFound();

  // Fetch case
  const { data: caseData } = await supabase
    .from('cases')
    .select('*')
    .eq('person_id', id)
    .single();

  // Fetch assessments (for trend)
  const { data: assessments } = await supabase
    .from('assessments')
    .select('*')
    .eq('person_id', id)
    .order('created_at', { ascending: true });

  // Fetch alerts
  const { data: alerts } = await supabase
    .from('alerts')
    .select('*')
    .eq('person_id', id)
    .order('created_at', { ascending: false });

  // Audit: log view
  await supabase.from('audit_events').insert({
    actor: 'staff-user',
    role: 'counsellor',
    action: 'view_person',
    subject_id: id,
  });

  const latest = assessments?.[assessments.length - 1];

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

          {/* Component Breakdown */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Component Breakdown</h3>
            {Object.entries(latest.contributions as Record<string, number | null>).map(([key, value]) => {
              const component = (latest.components as Record<string, number | null>)[key];
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs font-mono uppercase w-8">{key}</span>
                  <div className="flex-1 bg-line h-8 rounded relative overflow-hidden">
                    {value !== null && (
                      <div
                        className="bg-accent h-full"
                        style={{ width: `${value}%` }}
                      />
                    )}
                  </div>
                  <span className="text-sm w-20 text-right">
                    {value !== null ? value.toFixed(1) : 'N/A'}
                    {component !== null && (
                      <span className="text-ink-soft ml-1">({component})</span>
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
                {(latest.explanation as string[]).map((line, i) => (
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

      {/* Trend History */}
      {assessments && assessments.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Trend ({assessments.length} assessments)</h2>
          <div className="space-y-3">
            {assessments.map((a: any, i: number) => (
              <div key={a.id} className="flex items-center gap-4 text-sm">
                <span className="text-ink-soft w-12">#{i + 1}</span>
                <TierBadge tier={a.tier} />
                <span className="font-mono">{a.composite.toFixed(1)}</span>
                {a.change_point && (
                  <span className="text-red-700 font-semibold">↑ Change Point</span>
                )}
                <span className="text-ink-soft ml-auto">
                  {new Date(a.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Alerts */}
      {alerts && alerts.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Alerts ({alerts.length})</h2>
          <div className="space-y-2 text-sm">
            {alerts.map((alert: any) => (
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
