import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json() as any;
    return NextResponse.json({ success: true, data: body });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ success: true, data: [] });
}