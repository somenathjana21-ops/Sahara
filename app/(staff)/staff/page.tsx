// app/(staff)/staff/page.tsx — Staff queue dashboard

import { createClient } from '@supabase/supabase-js';
import { TierBadge } from '@/components/ui/TierBadge';
import { Card } from '@/components/ui/Card';
import Link from 'next/link';
import type { Tier } from '@/types/contract';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function StaffQueuePage() {
  // Fetch unacked alerts
  const { data: alerts } = await supabase
    .from('alerts')
    .select(`
      id,
      person_id,
      tier,
      created_at,
      persons!inner(pseudonym),
      assessments!inner(composite, change_point, created_at)
    `)
    .is('acked_at', null)
    .order('tier', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(50);

  const queue = alerts || [];

  // Tier priority for sorting
  const tierOrder: Record<string, number> = { CRITICAL: 0, RED: 1, AMBER: 2, GREEN: 3 };
  const sorted = queue.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">Queue ({queue.length})</h2>
        <p className="text-sm text-ink-soft mt-1">
          Unacknowledged alerts, sorted by priority
        </p>
      </div>

      {queue.length === 0 && (
        <Card className="p-8 text-center text-ink-soft">
          No pending alerts. Queue is clear.
        </Card>
      )}

      <div className="space-y-3">
        {sorted.map((item: any) => (
          <Link
            key={item.id}
            href={`/staff/person/${item.person_id}`}
            className="block"
          >
            <Card className="p-4 hover:border-accent transition-colors cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <TierBadge tier={item.tier as Tier} />
                  <div>
                    <p className="font-semibold">{item.persons.pseudonym}</p>
                    <p className="text-sm text-ink-soft">
                      Composite: {item.assessments.composite.toFixed(1)}
                      {item.assessments.change_point && (
                        <span className="ml-2 text-red-700">↑ Change point</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="text-sm text-ink-soft">
                  {new Date(item.created_at).toLocaleString()}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
