import { type NextRequest } from 'next/server';

export async function POST(req: NextRequest): Promise<Response> {
  return Response.json({ error: 'غير متاح حالياً' }, { status: 503 });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}