"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  authNoticeFromCookies,
  clearAuthNoticeCookie,
} from "@/lib/auth-notices";

/**
 * Says what just happened during sign-in, when the sign-in system left a note
 * for it (Google being connected to an older account). It reads the note once
 * and removes it, so it shows on the page the person lands on and not again.
 *
 * It stays until they close it: it says their old password has gone, which is
 * worth reading.
 */
export function AuthNoticeToast() {
  React.useEffect(() => {
    let notice;
    try {
      notice = authNoticeFromCookies(document.cookie);
    } catch {
      return;
    }
    if (!notice) return;
    document.cookie = clearAuthNoticeCookie();
    toast.success(notice.title, {
      description: notice.message,
      duration: Infinity,
      closeButton: true,
    });
  }, []);

  return null;
}
