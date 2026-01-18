import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect("/login");
  }

  // Troca code por access token
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI!,
    }),
  });

  const token = await tokenRes.json();

  // Busca dados do usuário
  const userRes = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

  const user = await userRes.json();

  const response = NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL}/login`
  );

response.cookies.set("discord_user", JSON.stringify(user), {
  path: "/",
  maxAge: 60 * 60 * 24,
});

  return response;
}
