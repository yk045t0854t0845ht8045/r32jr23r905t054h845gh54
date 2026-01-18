import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies(); //  FIX AQUI
  const user = cookieStore.get("discord_user");

  if (!user) {
    return NextResponse.json({ user: null });
  }

  try {
    return NextResponse.json({
      user: JSON.parse(user.value),
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
