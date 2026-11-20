import { googleLinkingOptions } from "./googleAutoLink";
import { kenyanPhoneRules } from "./kenyanPhone";

// Google linking and the phone number rules both use better-auth's hook slots.
// Spreading both into the settings would let whichever came second silently
// replace the first, so they are joined here. The real sign-in setup and its
// tests both use this, so they can't drift apart.
export const signInRules = {
  ...googleLinkingOptions,
  databaseHooks: {
    ...googleLinkingOptions.databaseHooks,
    ...kenyanPhoneRules.databaseHooks,
  },
  hooks: {
    ...googleLinkingOptions.hooks,
    ...kenyanPhoneRules.hooks,
  },
};
