// app/api/staff/queue/route.ts — Get queue of alerts for counsellor

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { QueueItem } from '@/types/contract';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  // Check auth
  const cookieStore = await cookies();
  if (!cookieStore.get('staff_auth')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get unacked alerts sorted by tier priority + time
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select(`
      id,
      person_id,
      tier,
      sla_minutes,
      created_at,
      acked_at,
      persons!inner(pseudonym),
      assessments!inner(composite, change_point)
    `)
    .is('acked_at', null)
    .order('tier', { ascending: false }) // CRITICAL > RED > AMBER
    .order('created_at', { ascending: true }) // Oldest first
    .limit(50);

  if (error) {
    console.error('Queue fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Transform to QueueItem format
  const queue: QueueItem[] = (alerts || []).map((a: any) => ({
    personId: a.person_id,
    pseudonym: a.persons.pseudonym,
    tier: a.tier,
    composite: a.assessments.composite,
    changePoint: a.assessments.change_point,
    createdAt: a.created_at,
    acked: false,
    slaMinutes: a.sla_minutes,
  }));

  // Audit: log queue view
  await supabase.from('audit_events').insert({
    actor: 'staff-user', // In real system, use actual staff ID
    role: 'counsellor',
    action: 'view_queue',
    subject_id: null,
  });

  return NextResponse.json(queue);
}
