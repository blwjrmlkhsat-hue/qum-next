import { type NextRequest } from 'next/server';

export async function POST(req: NextRequest): Promise<Response> {
  return Response.json({ error: 'غير متاح حالياً' }, { status: 503 });
}