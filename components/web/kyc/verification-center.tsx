"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/components/web/admin/utils";
import { formatKes } from "@/components/web/kyc/format";
import { Tier1Form, Tier2Form } from "@/components/web/kyc/kyc-forms";
import { tierPayoutLimitKes } from "@/lib/kyc";

const LEVELS = [
  {
    tier: 1,
    title: "Confirm who you are",
    detail: "Your ID, a mobile number in your name, and what the money is for.",
  },
  {
    tier: 2,
    title: "Back up your campaign",
    detail: "Evidence for the campaign, your KRA PIN and proof of your payout account.",
  },
] as const;

export function VerificationCenter() {
  const kyc = useQuery(api.kyc.getMyKyc);

  if (kyc === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (kyc === null) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">
          Verify your identity
        </h1>
        <p className="text-muted-foreground">
          Sign in to verify your identity and receive payouts.
        </p>
        <Link href="/sign-in" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Verify your identity
        </h1>
        <p className="text-muted-foreground">
          We check everyone who receives money through GoUplift. You can raise
          funds while you wait, but nothing can be paid out to you until you
          are verified.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-xl">Your verification</CardTitle>
            <Badge variant={kyc.tier > 0 ? "default" : "outline"}>
              {kyc.tier > 0 ? `Level ${kyc.tier}` : "Not verified"}
            </Badge>
          </div>
          <CardDescription>
            {kyc.tier === 0
              ? "Nothing can be paid out to you yet."
              : kyc.payoutLimitKes === null
                ? "Your payouts are reviewed individually by our compliance team."
                : `We can pay out up to ${formatKes(kyc.payoutLimitKes)} to you in total.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {LEVELS.map((level) => {
              const done = kyc.tier >= level.tier;
              const waiting = kyc.pending?.requestedTier === level.tier;
              const Icon = done ? CheckCircle2 : waiting ? Clock : Circle;
              return (
                <li key={level.tier} className="flex gap-3">
                  <Icon
                    className={
                      done
                        ? "mt-0.5 size-5 shrink-0 text-primary"
                        : "mt-0.5 size-5 shrink-0 text-muted-foreground"
                    }
                    aria-hidden
                  />
                  <div className="space-y-0.5 text-sm">
                    <p className="font-medium">
                      Level {level.tier}: {level.title}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · up to {formatKes(tierPayoutLimitKes(level.tier))}
                      </span>
                    </p>
                    <p className="text-muted-foreground">{level.detail}</p>
                    {waiting && <p className="text-xs">Under review</p>}
                  </div>
                </li>
              );
            })}
          </ol>

          {kyc.identity && (
            <p className="mt-5 border-t pt-4 text-sm text-muted-foreground">
              Verified as{" "}
              <span className="font-medium text-foreground">
                {kyc.identity.legalName}
              </span>
              . ID {kyc.identity.idNumberMasked}
              {kyc.identity.phoneNumber && ` · ${kyc.identity.phoneNumber}`}
            </p>
          )}
        </CardContent>
      </Card>

      {kyc.pending ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">We&apos;re checking your documents</CardTitle>
            <CardDescription>
              You sent your Level {kyc.pending.requestedTier} details on{" "}
              {formatDate(kyc.pending.submittedAt)}. This page updates as soon
              as someone has reviewed them.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {kyc.rejection && (
            <div
              role="alert"
              className="space-y-1 rounded-xl border border-destructive/50 p-4 text-sm"
            >
              <p className="font-medium">
                Your last Level {kyc.rejection.requestedTier}{" "}
                application wasn&apos;t approved.
              </p>
              {kyc.rejection.reason && (
                <p className="text-muted-foreground">{kyc.rejection.reason}</p>
              )}
              <p className="text-muted-foreground">
                You can send it again below.
              </p>
            </div>
          )}

          {kyc.tier >= 1 && (
            <p className="text-sm text-muted-foreground">
              Next, choose where your money is paid on the{" "}
              <Link href="/payouts" className="underline underline-offset-4">
                payouts page
              </Link>
              .
            </p>
          )}

          {kyc.nextTier === 1 && <Tier1Form />}
          {kyc.nextTier === 2 && (
            <Tier2Form legalName={kyc.identity?.legalName ?? null} />
          )}
          {kyc.nextTier === null && (
            <p className="text-sm text-muted-foreground">
              You&apos;re fully verified. Payouts above{" "}
              {formatKes(tierPayoutLimitKes(2))} need extra checks and approval
              from our compliance team.
            </p>
          )}
        </>
      )}
    </div>
  );
}
