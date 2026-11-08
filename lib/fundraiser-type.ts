/** "COMMUNITY_HARAMBEE" -> "Community Harambee" */
export function formatFundraiserType(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "COMMUNITY_HARAMBEE" -> "community-harambee", used as a section id. */
export function fundraiserTypeAnchor(type: string) {
  return type.toLowerCase().replace(/_/g, "-");
}
