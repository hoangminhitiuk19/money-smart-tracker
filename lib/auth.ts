import { compare } from "bcryptjs";
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  checkLoginAttempt,
  type HeaderSource
} from "@/lib/security/rate-limit";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8)
});

type CredentialInput = Record<"email" | "password", string> | undefined;

type CredentialRequest = {
  headers?: HeaderSource;
};

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

export async function authorizeCredentials(
  credentials: CredentialInput,
  request: CredentialRequest
) {
  const parsedCredentials = credentialsSchema.safeParse(credentials);

  if (!parsedCredentials.success) {
    return null;
  }

  try {
    const decision = await checkLoginAttempt(
      request.headers ?? {},
      parsedCredentials.data.email
    );

    if (!decision.allowed || decision.unavailable) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: parsedCredentials.data.email }
    });

    if (!user) {
      return null;
    }

    const passwordMatches = await compare(
      parsedCredentials.data.password,
      user.passwordHash
    );

    if (!passwordMatches) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name
    };
  } catch {
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      authorize: authorizeCredentials
    })
  ],
  session: {
    strategy: "jwt"
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id;
      }

      return session;
    }
  },
  pages: {
    signIn: "/login"
  },
  secret: getServerEnv().NEXTAUTH_SECRET
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true
    }
  });
}

export async function requireAuth(): Promise<CurrentUser>;
export async function requireAuth(options: {
  onUnauthenticated: "return-null";
}): Promise<CurrentUser | null>;
export async function requireAuth(options?: { onUnauthenticated: "return-null" }) {
  const user = await getCurrentUser();

  if (!user) {
    if (options?.onUnauthenticated === "return-null") {
      return null;
    }

    redirect("/login");
  }

  return user;
}
