const rawStaffIds =
  process.env.PANEL_STAFF_DISCORD_IDS ||
  process.env.NEXT_PUBLIC_PANEL_STAFF_DISCORD_IDS ||
  '';

const staffSet = new Set(
  rawStaffIds
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

export function isStaffDiscordId(discordId?: string | null): boolean {
  if (!discordId) {
    return false;
  }
  return staffSet.has(discordId);
}

export function listStaffDiscordIds(): string[] {
  return Array.from(staffSet);
}
