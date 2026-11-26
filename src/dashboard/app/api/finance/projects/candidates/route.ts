import { projectCandidates } from '@finance/services/projects.js';
import { run, queryOf } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/finance/projects/candidates?propertyId=&search=&projectId= —
// transactions that could be linked to a project on that property.
export async function GET(req: Request) {
  return run((knex) => projectCandidates(knex, queryOf(req)));
}
