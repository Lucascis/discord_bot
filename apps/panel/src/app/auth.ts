import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import { isStaffDiscordId } from '@/lib/staff';

type DiscordProfileLike = {
  id?: string;
  image_url?: string | null;
};

type TokenLike = {
  discordId?: string;
  picture?: string | null;
  isStaff?: boolean;
};

type SessionUserLike = {
  id?: string;
  image?: string | null;
  isStaff?: boolean;
};

type SessionLike = {
  user?: SessionUserLike;
};

// @ts-expect-error NextAuth v5 beta types issue
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.AUTH_DISCORD_CLIENT_ID ?? '',
      clientSecret: process.env.AUTH_DISCORD_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          scope: 'identify guilds email'
        }
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account, profile }: { token: TokenLike; account?: unknown; profile?: unknown }) {
      const profileData = profile as DiscordProfileLike | undefined;
      if (account && profile) {
        token.discordId = profileData?.id;
        token.picture = profileData?.image_url ?? token.picture;
      }
      token.isStaff = isStaffDiscordId(token.discordId as string | undefined);
      return token;
    },
    async session({ session, token }: { session: SessionLike; token: TokenLike }) {
      if (session.user) {
        session.user.id = token.discordId || session.user.id;
        session.user.image = token.picture || session.user.image;
        session.user.isStaff = Boolean(token.isStaff);
      }
      return session;
    }
  }
});
