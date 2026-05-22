import { type NextRequest } from 'next/server';

export async function POST(req: NextRequest): Promise<Response> {
  return Response.json({ ok: true });
}

export async function DELETE(): Promise<Response> {
  return Response.json({ ok: true });
}