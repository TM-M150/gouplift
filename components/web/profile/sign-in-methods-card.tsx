"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { FaGoogle } from "react-icons/fa6";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { signInHref } from "@/lib/safe-redirect";
import {
  GOOGLE_CONNECTED_PATH,
  GOOGLE_PROVIDER,
  SETTINGS_PATH,
  describeSignInMethods,
  isLastWayIn,
  needsFreshSignIn,
  readLinkReturn,
  type LinkedAccount,
  type SignInMethods,
} from "@/lib/sign-in-methods";

export type SignInMethodsBusy = "connect" | "disconnect" | null;

export interface SignInMethodsViewProps {
  /** Null while the list is loading. */
  methods: SignInMethods | null;
  /** The list couldn't be loaded. */
  loadFailed: boolean;
  busy: SignInMethodsBusy;
  /** Disconnecting was refused because the sign-in is too old. */
  needsFreshSignIn: boolean;
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  onSignInAgain: () => void;
}

function MethodRow({
  icon,
  title,
  status,
  note,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
          {icon}
        </div>
        <div className="min-w-0 space-y-0.5 text-sm">
          <p className="font-medium">
            {title}{" "}
            <span className="ml-1 font-normal text-muted-foreground">
              {status}
            </span>
          </p>
          {note && <p className="text-muted-foreground">{note}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 pl-12 sm:pl-0">{action}</div>}
    </div>
  );
}

/** The words and buttons, apart from better-auth. */
export function SignInMethodsView({
  methods,
  loadFailed,
  busy,
  needsFreshSignIn: staleSignIn,
  confirmOpen,
  onConfirmOpenChange,
  onConnect,
  onDisconnect,
  onRetry,
  onSignInAgain,
}: SignInMethodsViewProps) {
  let body: React.ReactNode;

  if (loadFailed) {
    body = (
      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p role="alert" className="text-destructive">
          We couldn&apos;t load your sign-in methods.
        </p>
        <Button variant="outline" onClick={onRetry} className="self-start">
          Try again
        </Button>
      </div>
    );
  } else if (methods === null) {
    body = (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else {
    const connecting = busy === "connect";
    body = (
      <div className="divide-y">
        <MethodRow
          icon={<FaGoogle className="size-4 text-[#EA4335]" aria-hidden />}
          title="Google"
          status={methods.hasGoogle ? "Connected" : "Not connected"}
          note={
            methods.hasGoogle
              ? methods.canDisconnectGoogle
                ? "You can sign in with Google."
                : "You can sign in with Google. It's your only way to sign in, so it can't be disconnected."
              : "Connect Google to sign in with one tap. It has to use the same email address as your GoUplift account."
          }
          action={
            methods.hasGoogle ? (
              methods.canDisconnectGoogle ? (
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => onConfirmOpenChange(true)}
                >
                  Disconnect Google
                </Button>
              ) : null
            ) : (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={onConnect}
              >
                {connecting ? (
                  <>
                    <Spinner className="mr-2" />
                    Opening Google...
                  </>
                ) : (
                  "Connect Google"
                )}
              </Button>
            )
          }
        />
        <MethodRow
          icon={<KeyRound className="size-4" aria-hidden />}
          title="Password"
          status={methods.hasPassword ? "Set up" : "Not set up"}
          note={
            methods.hasPassword
              ? "Used with your email address or phone number."
              : "Add one with Forgot password on the sign-in page, and you'll be able to disconnect Google."
          }
        />
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Sign-in methods</CardTitle>
          <CardDescription>
            The ways you can sign in to your GoUplift account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {body}

          {staleSignIn && (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-lg border bg-muted/50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <p>
                For your security, please sign in again before disconnecting
                Google.
              </p>
              <Button
                variant="outline"
                onClick={onSignInAgain}
                className="self-start sm:self-auto"
              >
                Sign in again
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect Google?</DialogTitle>
            <DialogDescription>
              You won&apos;t be able to sign in with Google any more. You can
              still sign in with your password, and you can connect Google again
              here whenever you like.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              disabled={busy === "disconnect"}
              onClick={onDisconnect}
            >
              {busy === "disconnect" ? (
                <>
                  <Spinner className="mr-2" />
                  Disconnecting...
                </>
              ) : (
                "Disconnect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The card, wired to better-auth. */
export function SignInMethodsCard() {
  const router = useRouter();
  const params = useSearchParams();

  const [accounts, setAccounts] = React.useState<LinkedAccount[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [busy, setBusy] = React.useState<SignInMethodsBusy>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [staleSignIn, setStaleSignIn] = React.useState(false);

  // Which methods the person has. Re-run by bumping reloadKey.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await authClient.listAccounts();
      if (cancelled) return;
      if (error || !data) {
        setLoadFailed(true);
        return;
      }
      setAccounts(data.map((account) => ({ providerId: account.providerId })));
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function reload() {
    setLoadFailed(false);
    setAccounts(null);
    setReloadKey((key) => key + 1);
  }

  // Back from Google: say how it went, then tidy the address.
  const handledReturn = React.useRef(false);
  React.useEffect(() => {
    if (handledReturn.current) return;
    const result = readLinkReturn(params);
    if (!result) return;
    handledReturn.current = true;
    if (result.kind === "connected") {
      toast.success("Google is connected.", {
        description: "You can now sign in with Google.",
      });
    } else {
      toast.error("Couldn't connect Google", { description: result.message });
    }
    router.replace(SETTINGS_PATH);
  }, [params, router]);

  async function handleConnect() {
    setBusy("connect");
    const { error } = await authClient.linkSocial({
      provider: GOOGLE_PROVIDER,
      callbackURL: GOOGLE_CONNECTED_PATH,
      errorCallbackURL: SETTINGS_PATH,
    });
    // On success the browser is already on its way to Google.
    if (error) {
      toast.error("Couldn't connect Google", {
        description: error.message ?? "Please try again.",
      });
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    const { error } = await authClient.unlinkAccount({
      providerId: GOOGLE_PROVIDER,
    });
    setBusy(null);
    setConfirmOpen(false);

    if (!error) {
      setStaleSignIn(false);
      toast.success("Google is disconnected.");
      reload();
    } else if (needsFreshSignIn(error)) {
      setStaleSignIn(true);
    } else if (isLastWayIn(error)) {
      toast.error("Google is your only way to sign in.", {
        description: "It can't be disconnected.",
      });
      reload();
    } else {
      toast.error("Couldn't disconnect Google", {
        description: error.message ?? "Please try again.",
      });
    }
  }

  async function handleSignInAgain() {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push(signInHref(SETTINGS_PATH)),
        onError: (ctx) => {
          toast.error(ctx.error.message || "Couldn't sign you out");
        },
      },
    });
  }

  return (
    <SignInMethodsView
      methods={accounts ? describeSignInMethods(accounts) : null}
      loadFailed={loadFailed}
      busy={busy}
      needsFreshSignIn={staleSignIn}
      confirmOpen={confirmOpen}
      onConfirmOpenChange={setConfirmOpen}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      onRetry={reload}
      onSignInAgain={handleSignInAgain}
    />
  );
}
