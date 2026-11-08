"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { errorMessage, formatDateTime } from "@/components/web/admin/utils";
import { AddAccountForm } from "@/components/web/payouts/add-account-form";
import {
  ACCOUNT_STATUS_DISPLAY,
  describeAccount,
} from "@/components/web/payouts/format";
import {
  PAYOUT_ACCOUNT_CHANGE_HOLD_MS,
  PAYOUT_HOLDER_LABELS,
  payoutChangeHeldUntil,
} from "@/lib/payout-accounts";

type Accounts = NonNullable<
  FunctionReturnType<typeof api.payoutAccounts.getMyPayoutAccounts>
>;
type OwnerAccount = Accounts["personal"][number];
type Destination = NonNullable<
  FunctionReturnType<typeof api.payoutAccounts.getMyPayoutDestinations>
>[number];

const HOLD_HOURS = PAYOUT_ACCOUNT_CHANGE_HOLD_MS / (60 * 60 * 1000);

const isOpen = (account: OwnerAccount) =>
  account.status === "PENDING_REVIEW" || account.status === "VERIFIED";

function AccountRow({
  account,
  onRemove,
}: {
  account: OwnerAccount;
  onRemove: (account: OwnerAccount) => void;
}) {
  const status = ACCOUNT_STATUS_DISPLAY[account.status];
  return (
    <li className="space-y-1.5 rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium">{describeAccount(account)}</p>
          <p className="text-muted-foreground">
            {account.accountName} · {PAYOUT_HOLDER_LABELS[account.holder]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          {isOpen(account) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onRemove(account)}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      {account.status === "REJECTED" && (
        <p className="text-muted-foreground">
          {account.rejectionReason ??
            "This account wasn't approved. You can add it again with clearer proof."}
        </p>
      )}
    </li>
  );
}

function AccountsCard({
  title,
  description,
  accounts,
  onRemove,
  children,
}: {
  title: string;
  description: string;
  accounts: OwnerAccount[];
  onRemove: (account: OwnerAccount) => void;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accounts.length > 0 ? (
          <ul className="space-y-3">
            {accounts.map((account) => (
              <AccountRow
                key={account._id}
                account={account}
                onRemove={onRemove}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No payout accounts yet.
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

// Level 1: money goes to the mobile number a reviewer has already confirmed.
function UseVerifiedNumber({
  phone,
  legalName,
}: {
  phone: string;
  legalName: string;
}) {
  const addAccount = useMutation(api.payoutAccounts.addPayoutAccount);
  const [saving, setSaving] = React.useState(false);

  async function handleClick() {
    setSaving(true);
    try {
      await addAccount({
        method: "MPESA",
        holder: "OWN",
        accountName: legalName,
        mpesaNumber: phone,
      });
      toast.success("Account added and verified");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button type="button" onClick={handleClick} disabled={saving}>
      {saving ? "Adding…" : `Use my verified number (${phone})`}
    </Button>
  );
}

function AddAccountSection({
  organizationId,
  accounts,
  maxOpen,
  verifiedPhone,
}: {
  organizationId?: Id<"organizations">;
  accounts: OwnerAccount[];
  maxOpen: number;
  verifiedPhone: string | null;
}) {
  const [adding, setAdding] = React.useState(false);
  const full = accounts.filter(isOpen).length >= maxOpen;

  if (adding) {
    return (
      <AddAccountForm
        organizationId={organizationId}
        verifiedPhone={verifiedPhone}
        onDone={() => setAdding(false)}
        onCancel={() => setAdding(false)}
      />
    );
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => setAdding(true)}
        disabled={full}
      >
        Add an account
      </Button>
      {full && (
        <p className="text-xs text-muted-foreground">
          You can have up to {maxOpen} accounts. Remove one to add another.
        </p>
      )}
    </div>
  );
}

function payoutState(destination: Destination, now: number) {
  if (!destination.payoutAccountId) return "No account chosen yet.";
  switch (destination.accountStatus) {
    case "PENDING_REVIEW":
      return "The account you chose is being reviewed.";
    case "VERIFIED": {
      if (destination.changedAt !== null) {
        const until = payoutChangeHeldUntil(destination.changedAt);
        if (now < until) {
          return `You changed the account recently, so payouts are paused until ${formatDateTime(until)}.`;
        }
      }
      return "Payouts go to this account.";
    }
    default:
      return "The account you chose can't be used. Choose another.";
  }
}

function DestinationRow({
  destination,
  options,
  now,
  onChoose,
}: {
  destination: Destination;
  options: OwnerAccount[];
  now: number;
  onChoose: (destination: Destination, account: OwnerAccount) => void;
}) {
  const open = options.filter(isOpen);
  const items = Object.fromEntries(
    open.map((account) => [
      account._id,
      `${describeAccount(account)}${account.status === "PENDING_REVIEW" ? " (under review)" : ""}`,
    ]),
  );
  const selected = open.some((a) => a._id === destination.payoutAccountId)
    ? destination.payoutAccountId
    : null;

  return (
    <li className="space-y-3 rounded-xl border p-4 text-sm">
      <div className="space-y-0.5">
        <p className="font-medium">{destination.title}</p>
        {destination.organizationName && (
          <p className="text-muted-foreground">{destination.organizationName}</p>
        )}
      </div>

      {open.length > 0 ? (
        <Select
          items={items}
          value={selected}
          onValueChange={(value) => {
            const account = open.find((a) => a._id === value);
            if (account && account._id !== destination.payoutAccountId) {
              onChoose(destination, account);
            }
          }}
        >
          <SelectTrigger
            className="w-full sm:w-80"
            aria-label={`Payout account for ${destination.title}`}
          >
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {open.map((account) => (
              <SelectItem key={account._id} value={account._id}>
                {items[account._id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-muted-foreground">
          Add a payout account above to choose where this one is paid.
        </p>
      )}

      <p className="text-muted-foreground">{payoutState(destination, now)}</p>
    </li>
  );
}

export function PayoutsCenter() {
  const accounts = useQuery(api.payoutAccounts.getMyPayoutAccounts);
  const destinations = useQuery(api.payoutAccounts.getMyPayoutDestinations);
  const kyc = useQuery(api.kyc.getMyKyc);

  const closeAccount = useMutation(api.payoutAccounts.closePayoutAccount);
  const setAccount = useMutation(api.payoutAccounts.setFundraiserPayoutAccount);

  const [now] = React.useState(() => Date.now());
  const [removing, setRemoving] = React.useState<OwnerAccount | null>(null);
  const [choosing, setChoosing] = React.useState<{
    destination: Destination;
    account: OwnerAccount;
  } | null>(null);

  if (
    accounts === undefined ||
    destinations === undefined ||
    kyc === undefined
  ) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (accounts === null || destinations === null) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Payouts</h1>
        <p className="text-muted-foreground">
          Sign in to choose where your money is paid.
        </p>
        <Link href="/sign-in" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    );
  }

  const optionsFor = (destination: Destination): OwnerAccount[] =>
    destination.organizationId
      ? (accounts.organizations.find((o) => o._id === destination.organizationId)
          ?.accounts ?? [])
      : accounts.personal;

  const needsVerification =
    accounts.tier === 0 && accounts.organizations.length === 0;

  const hasVerifiedNumber =
    accounts.verifiedPhone !== null &&
    accounts.personal.some(
      (account) => isOpen(account) && account.mpesaNumber === accounts.verifiedPhone,
    );

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Payouts</h1>
        <p className="text-muted-foreground">
          Money is only ever sent to an account we have verified. Add the
          account, then choose it for each fundraiser.
        </p>
      </div>

      {needsVerification && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Verify your identity first</CardTitle>
            <CardDescription>
              We can only pay out to people we have verified.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/verification" className={buttonVariants()}>
              Verify now
            </Link>
          </CardContent>
        </Card>
      )}

      {accounts.tier >= 1 && (
        <AccountsCard
          title="Your payout accounts"
          description={
            accounts.tier === 1
              ? "At Level 1, payouts go to the mobile number you verified."
              : "Accounts in your name, or a verified beneficiary's such as a hospital or school."
          }
          accounts={accounts.personal}
          onRemove={setRemoving}
        >
          {accounts.tier === 1 ? (
            <div className="space-y-2">
              {!hasVerifiedNumber && accounts.verifiedPhone && (
                <UseVerifiedNumber
                  phone={accounts.verifiedPhone}
                  legalName={kyc?.identity?.legalName ?? "Account holder"}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Reach Level 2 to use a different number or a bank account.{" "}
                <Link
                  href="/verification"
                  className="underline underline-offset-4"
                >
                  Go to verification
                </Link>
              </p>
            </div>
          ) : (
            <AddAccountSection
              accounts={accounts.personal}
              maxOpen={accounts.maxOpenAccounts}
              verifiedPhone={accounts.verifiedPhone}
            />
          )}
        </AccountsCard>
      )}

      {accounts.organizations.map((organization) => (
        <AccountsCard
          key={organization._id}
          title={`${organization.name}: payout accounts`}
          description="Accounts in the organization's name. Only its owner can add or choose them."
          accounts={organization.accounts}
          onRemove={setRemoving}
        >
          {organization.isVerified ? (
            <AddAccountSection
              organizationId={organization._id}
              accounts={organization.accounts}
              maxOpen={accounts.maxOpenAccounts}
              verifiedPhone={null}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              The organization has to be verified before you can add an
              account.
            </p>
          )}
        </AccountsCard>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Where each fundraiser is paid</CardTitle>
          <CardDescription>
            Changing the account of a fundraiser that is already set up pauses
            its payouts for {HOLD_HOURS} hours, and the new account has to be
            verified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {destinations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You don&apos;t have any fundraisers yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {destinations.map((destination) => (
                <DestinationRow
                  key={destination.fundraiserId}
                  destination={destination}
                  options={optionsFor(destination)}
                  now={now}
                  onChoose={(target, account) => {
                    // Setting a first account is routine; replacing one is a
                    // change that pauses payouts, so it is confirmed.
                    if (target.payoutAccountId) {
                      setChoosing({ destination: target, account });
                      return;
                    }
                    setAccount({
                      fundraiserId: target.fundraiserId,
                      payoutAccountId: account._id,
                    }).then(
                      () => toast.success("Payout account chosen"),
                      (err) => toast.error(errorMessage(err)),
                    );
                  }}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DecisionDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this payout account?"
        description="Any fundraiser paid to it can't be paid out until you choose another verified account."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await closeAccount({ payoutAccountId: removing._id });
          toast.success("Account removed");
        }}
      />

      <DecisionDialog
        open={choosing !== null}
        onOpenChange={(open) => !open && setChoosing(null)}
        title="Change where this fundraiser is paid?"
        description={`Payouts for “${choosing?.destination.title ?? ""}” will pause for ${HOLD_HOURS} hours, and the new account has to be verified before money is sent.`}
        confirmLabel="Change account"
        onConfirm={async () => {
          if (!choosing) return;
          await setAccount({
            fundraiserId: choosing.destination.fundraiserId,
            payoutAccountId: choosing.account._id,
          });
          toast.success("Payout account changed");
        }}
      />
    </div>
  );
}
