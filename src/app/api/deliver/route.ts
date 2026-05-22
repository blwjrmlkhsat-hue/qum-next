import { type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return Response.json({ error: 'غير متاح حالياً' }, { status: 503 });
}