// @vitest-environment node
//
// Tidying the phone numbers of accounts saved before numbers were kept as
// +254XXXXXXXXX. The last group runs it against better-auth's real code, to
// show that signing in by phone starts to work afterwards.

import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { phoneNumber } from "better-auth/plugins";
import {
  planPhoneBackfill,
  runPhoneBackfill,
  type BackfillDeps,
  type StoredPhone,
} from "./lib/phoneBackfill";
import { signInRules } from "./lib/signInRules";

const row = (authUserId: string, phoneNumber: string): StoredPhone => ({
  authUserId,
  phoneNumber,
});

describe("planPhoneBackfill", () => {
  it("leaves numbers that are already tidy alone", () => {
    const plan = planPhoneBackfill([row("a", "+254712345678")]);
    expect(plan).toEqual({
      checked: 1,
      alreadyTidy: 1,
      toUpdate: [],
      notKenyan: [],
      clashes: [],
    });
  });

  it("rewrites every usual way of typing a Kenyan mobile number", () => {
    const plan = planPhoneBackfill([
      row("a", "0712345678"),
      row("b", "0722 000 111"),
      row("c", "254733000111"),
      row("d", "+254 744 000 111"),
      row("e", "0112-345-678"),
    ]);
    expect(plan.toUpdate).toEqual([
      { authUserId: "a", to: "+254712345678" },
      { authUserId: "b", to: "+254722000111" },
      { authUserId: "c", to: "+254733000111" },
      { authUserId: "d", to: "+254744000111" },
      { authUserId: "e", to: "+254112345678" },
    ]);
    expect(plan.alreadyTidy).toBe(0);
  });

  it("reports numbers that aren't Kenyan mobiles and doesn't touch them", () => {
    const plan = planPhoneBackfill([
      row("us", "+14155550123"),
      row("tz", "+255712345678"),
      row("landline", "0212345678"),
      row("typo", "07123"),
    ]);
    expect(plan.notKenyan).toEqual(["us", "tz", "landline", "typo"]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.checked).toBe(4);
  });

  it("ignores accounts with no number", () => {
    const plan = planPhoneBackfill([row("a", ""), row("b", "   ")]);
    expect(plan.checked).toBe(0);
    expect(plan.notKenyan).toEqual([]);
  });

  it("leaves two accounts alone when their numbers are the same number", () => {
    const plan = planPhoneBackfill([
      row("a", "0712345678"),
      row("b", "+254 712 345 678"),
      row("c", "0722000111"),
    ]);
    expect(plan.clashes).toEqual(["a", "b"]);
    expect(plan.toUpdate).toEqual([{ authUserId: "c", to: "+254722000111" }]);
  });

  it("leaves an account alone when its number is one another account already holds", () => {
    const plan = planPhoneBackfill([
      row("holder", "+254712345678"),
      row("other", "0712 345 678"),
    ]);
    expect(plan.clashes).toEqual(["other"]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.alreadyTidy).toBe(1);
  });

  it("has nothing left to do once its plan has been carried out", () => {
    const rows = [row("a", "0712345678"), row("b", "254722000111")];
    const plan = planPhoneBackfill(rows);
    const after = rows.map((r) => {
      const change = plan.toUpdate.find((u) => u.authUserId === r.authUserId);
      return change ? row(r.authUserId, change.to) : r;
    });
    const again = planPhoneBackfill(after);
    expect(again.toUpdate).toEqual([]);
    expect(again.alreadyTidy).toBe(2);
  });
});

describe("runPhoneBackfill", () => {
  function fakeStore(initial: StoredPhone[]) {
    const store = new Map(initial.map((r) => [r.authUserId, r.phoneNumber]));
    const writes: Array<[string, string]> = [];
    const failOn = new Set<string>();
    const deps: BackfillDeps = {
      listPhones: async () =>
        [...store].map(([authUserId, phoneNumber]) => ({
          authUserId,
          phoneNumber,
        })),
      setPhone: async (authUserId, phoneNumber) => {
        if (failOn.has(authUserId)) throw new Error("nope");
        writes.push([authUserId, phoneNumber]);
        store.set(authUserId, phoneNumber);
      },
    };
    return { deps, store, writes, failOn };
  }
  const messy = () => [
    row("a", "0712345678"),
    row("b", "0722 000 111"),
    row("us", "+14155550123"),
    row("ok", "+254733000111"),
  ];

  it("changes nothing unless told to, and says what it would do", async () => {
    const { deps, writes, store } = fakeStore(messy());
    const summary = await runPhoneBackfill(deps, { apply: false });
    expect(writes).toEqual([]);
    expect(store.get("a")).toBe("0712345678");
    expect(summary).toEqual({
      applied: false,
      checked: 4,
      alreadyTidy: 1,
      toUpdate: 2,
      updated: 0,
      notKenyan: ["us"],
      clashes: [],
      failed: [],
    });
  });

  it("rewrites only the numbers that need it", async () => {
    const { deps, writes, store } = fakeStore(messy());
    const summary = await runPhoneBackfill(deps, { apply: true });
    expect(writes).toEqual([
      ["a", "+254712345678"],
      ["b", "+254722000111"],
    ]);
    expect(store.get("us")).toBe("+14155550123");
    expect(summary).toMatchObject({ applied: true, toUpdate: 2, updated: 2 });
  });

  it("carries on when one account can't be changed, and says which", async () => {
    const { deps, writes, failOn } = fakeStore(messy());
    failOn.add("a");
    const summary = await runPhoneBackfill(deps, { apply: true });
    expect(writes).toEqual([["b", "+254722000111"]]);
    expect(summary).toMatchObject({ toUpdate: 2, updated: 1, failed: ["a"] });
  });

  it("does nothing the second time", async () => {
    const { deps, writes } = fakeStore(messy());
    await runPhoneBackfill(deps, { apply: true });
    writes.length = 0;
    const again = await runPhoneBackfill(deps, { apply: true });
    expect(writes).toEqual([]);
    expect(again).toMatchObject({ toUpdate: 0, updated: 0, alreadyTidy: 3 });
  });

  it("keeps phone numbers out of what it reports", async () => {
    const { deps, failOn } = fakeStore(messy());
    failOn.add("b");
    const summary = await runPhoneBackfill(deps, { apply: true });
    expect(JSON.stringify(summary)).not.toMatch(/\d{7}/);
  });
});

describe("against the real sign-in code", () => {
  const BASE = "http://localhost:3000";
  const PASSWORD = "Sup3r-secret-pw";

  function makeAuth() {
    const db: Record<string, Array<Record<string, unknown>>> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const auth = betterAuth({
      baseURL: BASE,
      secret: "a-test-secret-that-is-long-enough-for-better-auth",
      database: memoryAdapter(db),
      trustedOrigins: [BASE],
      emailAndPassword: { enabled: true, requireEmailVerification: false },
      plugins: [phoneNumber()],
      ...signInRules,
    });
    return { auth, db };
  }

  const post = (path: string, body: unknown) =>
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify(body),
    });

  it("makes signing in by phone find accounts saved the old way", async () => {
    const { auth, db } = makeAuth();
    const spellings = ["0712345678", "0722 000 111", "254733000111"];
    for (const [i, phone] of spellings.entries()) {
      await auth.handler(
        post("/sign-up/email", {
          name: `Person ${i}`,
          email: `person${i}@example.test`,
          password: PASSWORD,
          phoneNumber: `07${i}0 000 000`, // any valid number; replaced below
        }),
      );
      // Saved as typed, as it was before numbers were kept in one form.
      db.user[i].phoneNumber = phone;
    }
    const legacy = (await auth.handler(
      post("/sign-up/email", {
        name: "Overseas",
        email: "overseas@example.test",
        password: PASSWORD,
        phoneNumber: "0799 000 000",
      }),
    )) as Response;
    expect(legacy.status).toBe(200);
    db.user[3].phoneNumber = "+14155550123";

    const signInWith = async (typed: string) =>
      (
        await auth.handler(
          post("/sign-in/phone-number", {
            phoneNumber: typed,
            password: PASSWORD,
          }),
        )
      ).status;

    // Before: the stored spellings don't match what is looked for.
    expect(await signInWith("0712345678")).toBe(401);
    expect(await signInWith("0722 000 111")).toBe(401);

    const { internalAdapter } = await auth.$context;
    const summary = await runPhoneBackfill(
      {
        listPhones: async () =>
          db.user.map((user) => ({
            authUserId: user.id as string,
            phoneNumber: user.phoneNumber as string,
          })),
        setPhone: async (authUserId, phone) => {
          await internalAdapter.updateUser(authUserId, { phoneNumber: phone });
        },
      },
      { apply: true },
    );

    expect(summary).toMatchObject({ toUpdate: 3, updated: 3, failed: [] });
    expect(summary.notKenyan).toEqual([db.user[3].id]);
    expect(db.user.map((user) => user.phoneNumber)).toEqual([
      "+254712345678",
      "+254722000111",
      "+254733000111",
      "+14155550123",
    ]);

    // After: however they type it.
    expect(await signInWith("0712345678")).toBe(200);
    expect(await signInWith("+254 722 000 111")).toBe(200);
    expect(await signInWith("0733 000 111")).toBe(200);
  });
});
