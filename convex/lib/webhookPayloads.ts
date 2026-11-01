import type { Doc, Id } from "../_generated/dataModel";

// The body of every webhook, written out field by field. This is the contract
// with organizations' servers, and it is also the privacy boundary: a donor's
// email and phone never leave GoUplift this way, and an anonymous donor's name
// and message are withheld, because a field only appears if it is named here.
// Fields may be added over time (receivers are told to ignore ones they don't
// know); removing or renaming one would break people's integrations.

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function donationCompletedEventId(donationId: Id<"donations">): string {
  // One event per donation, so the same id is reused if we ever enqueue twice
  // and receivers can drop duplicates by it.
  return `evt_donation_completed_${donationId}`;
}

export function buildDonationCompletedEvent(args: {
  donation: Doc<"donations">;
  organizationId: Id<"organizations">;
  createdAt: number;
}) {
  const { donation } = args;
  return {
    id: donationCompletedEventId(donation._id),
    type: "donation.completed" as const,
    createdAt: iso(args.createdAt),
    data: {
      donation: {
        id: donation._id,
        fundraiserId: donation.fundraiserId,
        organizationId: args.organizationId,
        // What the donor actually paid. A USD PayPal gift is reported in USD;
        // `grossAmount` is its KES equivalent and is only used when nothing
        // else was recorded (SasaPay is KES to begin with).
        amount: donation.originalAmount ?? donation.grossAmount,
        currency: donation.originalCurrency ?? donation.currency,
        source: donation.source ?? "WEB",
        isAnonymous: donation.isAnonymous,
        donorName: donation.isAnonymous ? null : (donation.donorName ?? null),
        message: donation.isAnonymous ? null : (donation.message ?? null),
        completedAt: iso(donation.completedAt ?? args.createdAt),
      },
    },
  };
}

export function buildPingEvent(args: { eventId: string; createdAt: number }) {
  return {
    id: args.eventId,
    type: "ping" as const,
    createdAt: iso(args.createdAt),
    data: { message: "This is a test event from GoUplift." },
  };
}
