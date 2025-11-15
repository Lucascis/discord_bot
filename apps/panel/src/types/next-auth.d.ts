declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      isStaff?: boolean;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    discordId?: string;
    picture?: string | null;
    isStaff?: boolean;
  }
}
