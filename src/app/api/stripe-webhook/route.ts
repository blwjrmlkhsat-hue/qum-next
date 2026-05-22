import { type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  return Response.json({ received: true });
}