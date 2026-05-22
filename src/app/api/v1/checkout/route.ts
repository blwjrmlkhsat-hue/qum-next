import { type NextRequest } from 'next/server';
import { Err, toResponse } from '@/lib/errors';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const { tenantId, name, email, productIds } = body;

    if (!tenantId || !name || !email || !productIds?.length) {
      throw Err.input('بيانات ناقصة');
    }

    return Response.json({
      orderId: 'pending',
      checkoutUrl: '',
      subtotal: 0,
      discount: 0,
      total: 0,
      couponCode: null,
    }, { status: 201 });

  } catch (err) {
    return toResponse(err);
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}