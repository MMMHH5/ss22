import { NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/deployment-urls';

export async function GET() {
    return NextResponse.redirect(`${API_BASE_URL}/auth/google`);
}
