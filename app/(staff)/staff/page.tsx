// app/(staff)/staff/page.tsx — Staff queue dashboard
// Fetches from /api/staff/queue so audit_events are written (CHECKS_TM3 T3-A7, T3-C6)

'use client';

import { useEffect, useState } from 'react';
import { TierBadge } from '@/components/ui/TierBadge';
import { Card } from '@/components/ui/Card';
import Link from 'next/link';
import type { Tier } from '@/types/contract';

interface QueueItem {
  personId: string;
  pseudonym: string;
  tier: Tier;
  composite: number;
  changePoint: boolean;
  createdAt: string;
  acked: boolean;
  slaMinutes: number;
}

export default function StaffQueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchQueue() {
      try {
        const res = await fetch('/api/staff/queue', { credentials: 'include' });
        if (!res.ok) {
          setError(`Queue fetch failed (${res.status})`);
          return;
        }
        const data: QueueItem[] = await res.json();
        setQueue(data);
      } catch {
        setError('Failed to load queue');
      } finally {
        setLoading(false);
      }
    }
    fetchQueue();
  }, []);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-8 text-center text-ink-soft">
        Loading queue…
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-8 text-center text-red-700">
        {error}
      </div>
    );
  }

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
        {queue.map((item) => (
          <Link
            key={item.personId}
            href={`/staff/person/${item.personId}`}
            className="block"
          >
            <Card className="p-4 hover:border-accent transition-colors cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <TierBadge tier={item.tier} />
                  <div>
                    <p className="font-semibold">{item.pseudonym}</p>
                    <p className="text-sm text-ink-soft">
                      Composite: {item.composite.toFixed(1)}
                      {item.changePoint && (
                        <span className="ml-2 text-red-700">↑ Change point</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="text-sm text-ink-soft">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
