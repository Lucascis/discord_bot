import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import { isStaffDiscordId } from '@/lib/staff';

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
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.discordId = profile.id as string;
        token.picture = profile.image_url ?? token.picture;
      }
      token.isStaff = isStaffDiscordId(token.discordId as string | undefined);
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.discordId as string) || session.user.id;
        session.user.image = (token.picture as string) || session.user.image;
        session.user.isStaff = Boolean(token.isStaff);
      }
      return session;
    }
  }
});
