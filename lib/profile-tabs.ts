// The tabs on the profile page, and which one to open. The page can be opened
// on a tab from the address (/profile?tab=settings), which is how coming back
// from Google after connecting an account lands on Settings rather than the
// first tab.

export const PROFILE_TABS = [
  "additional",
  "fundraisers",
  "impact",
  "settings",
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number];

export const DEFAULT_PROFILE_TAB: ProfileTab = "additional";

/** The tab an address asks for, or the first tab if it names none we have. */
export function profileTabFromParam(
  value: string | null | undefined,
): ProfileTab {
  return PROFILE_TABS.find((tab) => tab === value) ?? DEFAULT_PROFILE_TAB;
}
