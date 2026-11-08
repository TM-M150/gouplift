"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/components/web/admin/utils";
import { useDocumentUpload } from "@/components/web/kyc/use-document-upload";
import { DocumentUploadSlot } from "@/components/web/organization/document-upload-slot";
import {
  PAYOUT_HOLDERS,
  PAYOUT_HOLDER_LABELS,
  PAYOUT_METHODS,
  PAYOUT_METHOD_LABELS,
  PAYOUT_PROOF_SLOT,
  isVerifiedKycPhone,
  type PayoutHolder,
  type PayoutMethod,
} from "@/lib/payout-accounts";
import { payoutAccountDetailsSchema } from "@/lib/validations/payout-account";

interface AddAccountFormProps {
  /** Set to add an account for an organization the person owns. */
  organizationId?: Id<"organizations">;
  /** The mobile number already confirmed in the person's name, if any. */
  verifiedPhone: string | null;
  onDone: () => void;
  onCancel: () => void;
}

function isMethod(value: string | null): value is PayoutMethod {
  return value !== null && (PAYOUT_METHODS as readonly string[]).includes(value);
}
function isHolder(value: string | null): value is PayoutHolder {
  return value !== null && (PAYOUT_HOLDERS as readonly string[]).includes(value);
}

export function AddAccountForm({
  organizationId,
  verifiedPhone,
  onDone,
  onCancel,
}: AddAccountFormProps) {
  const addAccount = useMutation(api.payoutAccounts.addPayoutAccount);
  const { upload, discard } = useDocumentUpload();

  const [method, setMethod] = React.useState<PayoutMethod>("MPESA");
  const [holder, setHolder] = React.useState<PayoutHolder>("OWN");
  const [accountName, setAccountName] = React.useState("");
  const [mpesaNumber, setMpesaNumber] = React.useState("");
  const [bankName, setBankName] = React.useState("");
  const [bankAccountNumber, setBankAccountNumber] = React.useState("");
  const [justification, setJustification] = React.useState("");
  const [proof, setProof] = React.useState<File[]>([]);
  const [proofMissing, setProofMissing] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The number already confirmed at Level 1 needs no proof or review.
  const isVerifiedNumber =
    !organizationId &&
    isVerifiedKycPhone({ method, holder, mpesaNumber }, verifiedPhone);

  function changeProof(next: File[]) {
    discard(proof.filter((file) => !next.includes(file)));
    setProof(next);
    if (next.length > 0) setProofMissing(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = payoutAccountDetailsSchema.safeParse({
      method,
      holder,
      accountName,
      mpesaNumber,
      bankName,
      bankAccountNumber,
      justification,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Please check your details and try again.",
      );
      return;
    }

    if (!isVerifiedNumber && proof.length === 0) {
      setProofMissing(true);
      setError("Upload proof that the account is what you say it is.");
      return;
    }

    setSubmitting(true);
    try {
      const file = isVerifiedNumber ? undefined : proof[0];
      const result = await addAccount({
        organizationId,
        ...parsed.data,
        proof: file
          ? { storageId: await upload(file), fileName: file.name }
          : undefined,
      });
      toast.success(
        result.status === "VERIFIED"
          ? "Account added and verified"
          : "Account sent for review",
      );
      onDone();
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border bg-muted/20 p-4"
    >
      <fieldset disabled={submitting} className="min-w-0 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="payout-method">How should money be sent?</Label>
            <Select
              items={PAYOUT_METHOD_LABELS}
              value={method}
              onValueChange={(value) => isMethod(value) && setMethod(value)}
            >
              <SelectTrigger id="payout-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {PAYOUT_METHODS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {PAYOUT_METHOD_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="payout-holder">Whose account is it?</Label>
            <Select
              items={PAYOUT_HOLDER_LABELS}
              value={holder}
              onValueChange={(value) => isHolder(value) && setHolder(value)}
            >
              <SelectTrigger id="payout-holder" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {PAYOUT_HOLDERS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {PAYOUT_HOLDER_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="payout-name">Name on the account</Label>
          <Input
            id="payout-name"
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            autoComplete="off"
            required
          />
        </div>

        {method === "MPESA" ? (
          <div className="space-y-2">
            <Label htmlFor="payout-mpesa">M-Pesa number</Label>
            <Input
              id="payout-mpesa"
              type="tel"
              value={mpesaNumber}
              onChange={(event) => setMpesaNumber(event.target.value)}
              placeholder="0712 345 678"
              autoComplete="off"
              required
            />
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="payout-bank">Bank</Label>
              <Input
                id="payout-bank"
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                placeholder="Equity Bank"
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payout-bank-number">Account number</Label>
              <Input
                id="payout-bank-number"
                value={bankAccountNumber}
                onChange={(event) => setBankAccountNumber(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                required
              />
            </div>
          </div>
        )}

        {holder === "THIRD_PARTY" && (
          <div className="space-y-2">
            <Label htmlFor="payout-justification">
              Why should the money go to this account?
            </Label>
            <Textarea
              id="payout-justification"
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="e.g. This is the hospital's account for my father's surgery bill."
              className="min-h-20"
              maxLength={500}
              required
            />
          </div>
        )}

        {isVerifiedNumber ? (
          <p className="text-sm text-muted-foreground">
            This is the mobile number you verified, so it needs no proof and no
            extra review.
          </p>
        ) : (
          <DocumentUploadSlot
            slot={PAYOUT_PROOF_SLOT}
            files={proof}
            onChange={changeProof}
            disabled={submitting}
            invalid={proofMissing}
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting
              ? "Saving…"
              : isVerifiedNumber
                ? "Add account"
                : "Send for review"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
