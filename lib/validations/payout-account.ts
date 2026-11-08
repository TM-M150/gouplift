import { z } from "zod";
import { normalizeKenyanMobile } from "../kyc";
import {
  isPlausibleBankAccountNumber,
  normalizeBankAccountNumber,
  PAYOUT_HOLDERS,
  PAYOUT_METHODS,
  type PayoutHolder,
  type PayoutMethod,
} from "../payout-accounts";

export interface NormalizedPayoutAccountDetails {
  method: PayoutMethod;
  holder: PayoutHolder;
  accountName: string;
  // An M-Pesa account has a number; a bank account has a bank and an account number.
  mpesaNumber?: string;
  bankName?: string;
  bankAccountNumber?: string;
  // Only for an account that is someone else's.
  justification?: string;
}

// What adding a payout account asks for (policy 5.5). The values come out
// normalized, so the same number or account always compares equal.
export const payoutAccountDetailsSchema = z
  .object({
    method: z.enum(PAYOUT_METHODS, { error: "Choose how the money should be sent" }),
    holder: z.enum(PAYOUT_HOLDERS, { error: "Say whose account this is" }),
    accountName: z
      .string()
      .trim()
      .min(2, "Enter the name on the account")
      .max(100, "That name is too long"),
    mpesaNumber: z.string().trim().max(30).optional(),
    bankName: z.string().trim().max(60).optional(),
    bankAccountNumber: z.string().trim().max(40).optional(),
    justification: z.string().trim().max(500, "Keep this under 500 characters").optional(),
  })
  .superRefine((details, ctx) => {
    if (details.method === "MPESA") {
      if (!normalizeKenyanMobile(details.mpesaNumber ?? "")) {
        ctx.addIssue({
          code: "custom",
          path: ["mpesaNumber"],
          message: "Enter a Kenyan M-Pesa number, like 0712 345 678",
        });
      }
    } else {
      if (!details.bankName || details.bankName.length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["bankName"],
          message: "Enter the name of the bank",
        });
      }
      if (
        !isPlausibleBankAccountNumber(
          normalizeBankAccountNumber(details.bankAccountNumber ?? ""),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["bankAccountNumber"],
          message: "A bank account number is 6 to 20 digits",
        });
      }
    }

    if (
      details.holder === "THIRD_PARTY" &&
      (details.justification ?? "").length < 20
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["justification"],
        message:
          "Explain why the money should go to this account, for example that it is the hospital's account for the bill",
      });
    }
  })
  .transform((details): NormalizedPayoutAccountDetails => {
    const normalized: NormalizedPayoutAccountDetails = {
      method: details.method,
      holder: details.holder,
      accountName: details.accountName,
    };
    if (details.method === "MPESA") {
      normalized.mpesaNumber = normalizeKenyanMobile(details.mpesaNumber ?? "")!;
    } else {
      normalized.bankName = details.bankName!;
      normalized.bankAccountNumber = normalizeBankAccountNumber(
        details.bankAccountNumber ?? "",
      );
    }
    if (details.holder === "THIRD_PARTY") {
      normalized.justification = details.justification!;
    }
    return normalized;
  });

export type PayoutAccountDetails = NormalizedPayoutAccountDetails;
