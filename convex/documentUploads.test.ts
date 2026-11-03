/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// The real auth component needs a running Better Auth deployment. These tests
// only need `safeGetAuthUser`, so it reads the identity convex-test attaches.
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject } : null;
    },
  },
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const PDF = "application/pdf";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function later(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

async function setup() {
  const t = convexTest(schema, modules);
  const users = await t.run(async (ctx) => {
    const now = Date.now();
    const make = (authUserId: string) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName: authUserId,
        role: "USER",
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      });
    return { alice: await make("auth_alice"), bob: await make("auth_bob") };
  });
  return {
    t,
    users,
    asAlice: t.withIdentity({ subject: "auth_alice" }),
    asBob: t.withIdentity({ subject: "auth_bob" }),
  };
}

/** Puts a file straight into storage, the way an upload would. */
function store(t: T, opts: { type?: string; bytes?: number } = {}) {
  const { type = PDF, bytes = 1024 } = opts;
  return t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })),
  );
}

function inStorage(t: T, id: Id<"_storage">) {
  return t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
}

function pendingRows(t: T) {
  return t.run((ctx) => ctx.db.query("pendingUploads").collect());
}

describe("generateDocumentUploadUrl", () => {
  it("is for signed-in users only", async () => {
    const { t } = await setup();
    await expect(
      t.mutation(api.documentUploads.generateDocumentUploadUrl, {}),
    ).rejects.toThrow(/signed in/);
  });

  it("hands a signed-in user an upload URL", async () => {
    const { asAlice } = await setup();
    const url = await asAlice.mutation(
      api.documentUploads.generateDocumentUploadUrl,
      {},
    );
    expect(typeof url).toBe("string");
  });

  it("limits how many URLs one person gets per hour, and resets after", async () => {
    const { asAlice, asBob } = await setup();
    const request = (who: typeof asAlice) =>
      who.mutation(api.documentUploads.generateDocumentUploadUrl, {});

    for (let i = 0; i < 40; i++) await request(asAlice);
    await expect(request(asAlice)).rejects.toThrow(/try again in/);

    // Someone else is unaffected, and the window eventually passes.
    await expect(request(asBob)).resolves.toBeTypeOf("string");
    later(HOUR + MINUTE);
    await expect(request(asAlice)).resolves.toBeTypeOf("string");
  });

  it("refuses when too many files are already waiting", async () => {
    const { t, users, asAlice } = await setup();
    for (let i = 0; i < 30; i++) {
      const storageId = await store(t);
      await t.run((ctx) =>
        ctx.db.insert("pendingUploads", { storageId, userId: users.alice }),
      );
    }
    await expect(
      asAlice.mutation(api.documentUploads.generateDocumentUploadUrl, {}),
    ).rejects.toThrow(/too many uploaded files/);
  });
});

describe("registerDocumentUpload", () => {
  it("accepts a good file and records who uploaded it", async () => {
    const { t, users, asAlice } = await setup();
    const storageId = await store(t);

    const result = await asAlice.mutation(
      api.documentUploads.registerDocumentUpload,
      { storageId, fileName: "cert.pdf" },
    );

    expect(result).toEqual({ ok: true });
    const rows = await pendingRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ storageId, userId: users.alice });
    expect(await inStorage(t, storageId)).toBe(true);
  });

  it("is harmless to register the same file twice", async () => {
    const { t, asAlice } = await setup();
    const storageId = await store(t);
    const args = { storageId, fileName: "cert.pdf" };

    await asAlice.mutation(api.documentUploads.registerDocumentUpload, args);
    const again = await asAlice.mutation(
      api.documentUploads.registerDocumentUpload,
      args,
    );

    expect(again).toEqual({ ok: true });
    expect(await pendingRows(t)).toHaveLength(1);
  });

  it.each([
    ["a type that isn't allowed", { type: "text/html", bytes: 100 }, /supported file/],
    ["an empty file", { type: PDF, bytes: 0 }, /empty/],
    ["a file over 10 MB", { type: PDF, bytes: 10 * 1024 * 1024 + 1 }, /larger than 10 MB/],
  ])("rejects %s and deletes it from storage", async (_label, file, message) => {
    const { t, asAlice } = await setup();
    const storageId = await store(t, file);

    const result = await asAlice.mutation(
      api.documentUploads.registerDocumentUpload,
      { storageId, fileName: "scan" },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toMatch(message);
    expect(await inStorage(t, storageId)).toBe(false);
    expect(await pendingRows(t)).toHaveLength(0);
  });

  it("won't register, or delete, someone else's file", async () => {
    const { t, users, asAlice, asBob } = await setup();
    const storageId = await store(t);
    await asAlice.mutation(api.documentUploads.registerDocumentUpload, {
      storageId,
      fileName: "cert.pdf",
    });

    const result = await asBob.mutation(
      api.documentUploads.registerDocumentUpload,
      { storageId, fileName: "mine.pdf" },
    );

    expect(result).toMatchObject({ ok: false });
    expect(await inStorage(t, storageId)).toBe(true);
    expect((await pendingRows(t))[0].userId).toBe(users.alice);
  });

  it("ignores an old file, even an invalid one, and never deletes it", async () => {
    const { t, asAlice } = await setup();
    // Stands in for something that already belongs to someone else, such as a
    // profile photo: not a PDF, and uploaded well before this call.
    const storageId = await store(t, { type: "text/html", bytes: 100 });
    later(16 * MINUTE);

    const result = await asAlice.mutation(
      api.documentUploads.registerDocumentUpload,
      { storageId, fileName: "x" },
    );

    expect(result).toMatchObject({ ok: false });
    expect(await inStorage(t, storageId)).toBe(true);
    expect(await pendingRows(t)).toHaveLength(0);
  });

  it("refuses a file that is already part of a submission", async () => {
    const { t, users, asAlice } = await setup();
    const storageId = await store(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      const organizationId = await ctx.db.insert("organizations", {
        name: "Org",
        slug: "org",
        verificationStatus: "PENDING_REVIEW",
        createdBy: users.alice,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("organizationDocuments", {
        organizationId,
        documentType: "KRA_PIN",
        storageId,
        fileName: "pin.pdf",
        contentType: PDF,
        size: 1024,
        uploadedBy: users.alice,
        reviewStatus: "PENDING",
        createdAt: now,
      });
    });

    const result = await asAlice.mutation(
      api.documentUploads.registerDocumentUpload,
      { storageId, fileName: "pin.pdf" },
    );

    expect(result).toMatchObject({ ok: false });
    expect(await pendingRows(t)).toHaveLength(0);
  });

  it("is for signed-in users only", async () => {
    const { t } = await setup();
    const storageId = await store(t);
    await expect(
      t.mutation(api.documentUploads.registerDocumentUpload, {
        storageId,
        fileName: "x",
      }),
    ).rejects.toThrow(/signed in/);
  });
});

describe("discardDocumentUpload", () => {
  it("removes the person's own registered file and its row", async () => {
    const { t, asAlice } = await setup();
    const storageId = await store(t);
    await asAlice.mutation(api.documentUploads.registerDocumentUpload, {
      storageId,
      fileName: "cert.pdf",
    });

    await asAlice.mutation(api.documentUploads.discardDocumentUpload, {
      storageId,
    });

    expect(await inStorage(t, storageId)).toBe(false);
    expect(await pendingRows(t)).toHaveLength(0);
  });

  it("does nothing for someone else's file or an unregistered one", async () => {
    const { t, asAlice, asBob } = await setup();
    const registered = await store(t);
    const unregistered = await store(t);
    await asAlice.mutation(api.documentUploads.registerDocumentUpload, {
      storageId: registered,
      fileName: "cert.pdf",
    });

    await asBob.mutation(api.documentUploads.discardDocumentUpload, {
      storageId: registered,
    });
    await asAlice.mutation(api.documentUploads.discardDocumentUpload, {
      storageId: unregistered,
    });

    expect(await inStorage(t, registered)).toBe(true);
    expect(await inStorage(t, unregistered)).toBe(true);
    expect(await pendingRows(t)).toHaveLength(1);
  });
});

describe("sweepStaleDocumentUploads", () => {
  const sweep = (t: T) =>
    t.mutation(internal.documentUploads.sweepStaleDocumentUploads, {});

  it("deletes uploads nobody submitted after a day, and keeps newer ones", async () => {
    const { t, asAlice } = await setup();
    const old = await store(t);
    await asAlice.mutation(api.documentUploads.registerDocumentUpload, {
      storageId: old,
      fileName: "old.pdf",
    });

    later(25 * HOUR);
    const recent = await store(t);
    await asAlice.mutation(api.documentUploads.registerDocumentUpload, {
      storageId: recent,
      fileName: "recent.pdf",
    });

    await sweep(t);

    expect(await inStorage(t, old)).toBe(false);
    expect(await inStorage(t, recent)).toBe(true);
    const rows = await pendingRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].storageId).toBe(recent);
  });

  it("never deletes a file that is part of a submission", async () => {
    const { t, users, asAlice } = await setup();
    const storageId = await store(t);
    await asAlice.mutation(api.documentUploads.registerDocumentUpload, {
      storageId,
      fileName: "pin.pdf",
    });
    // A stale pending row for a file that did end up attached.
    await t.run(async (ctx) => {
      const now = Date.now();
      const organizationId = await ctx.db.insert("organizations", {
        name: "Org",
        slug: "org",
        verificationStatus: "PENDING_REVIEW",
        createdBy: users.alice,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("organizationDocuments", {
        organizationId,
        documentType: "KRA_PIN",
        storageId,
        fileName: "pin.pdf",
        contentType: PDF,
        size: 1024,
        uploadedBy: users.alice,
        reviewStatus: "PENDING",
        createdAt: now,
      });
    });

    later(25 * HOUR);
    await sweep(t);

    expect(await inStorage(t, storageId)).toBe(true);
    expect(await pendingRows(t)).toHaveLength(0);
  });

  it("carries on in further batches when there is a lot to clear", async () => {
    const { t, users } = await setup();
    for (let i = 0; i < 101; i++) {
      const storageId = await store(t, { bytes: 8 });
      await t.run((ctx) =>
        ctx.db.insert("pendingUploads", { storageId, userId: users.alice }),
      );
    }

    later(25 * HOUR);
    await sweep(t);
    expect(await pendingRows(t)).toHaveLength(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await pendingRows(t)).toHaveLength(0);
  });
});

describe("createOrganization with uploaded files", () => {
  // The documents an "Other registered body" must supply.
  const REQUIRED = [
    "REGISTRATION_CERTIFICATE",
    "PAYOUT_ACCOUNT_PROOF",
    "AUTHORISATION_RESOLUTION",
    "OFFICIAL_IDS",
  ] as const;

  const details = {
    name: "Nakuru Youth Trust",
    organizationType: "OTHER" as const,
    registrationNumber: "CPR/2020/1234",
  };

  async function registered(
    t: T,
    who: { mutation: T["mutation"] },
    documentType: (typeof REQUIRED)[number],
  ) {
    const storageId = await store(t);
    await who.mutation(api.documentUploads.registerDocumentUpload, {
      storageId,
      fileName: `${documentType}.pdf`,
    });
    return { documentType, storageId, fileName: `${documentType}.pdf` };
  }

  it("attaches the registered files and stops tracking them as pending", async () => {
    const { t, asAlice } = await setup();
    const documents = [];
    for (const type of REQUIRED) documents.push(await registered(t, asAlice, type));

    const { organizationId } = await asAlice.mutation(
      api.organizations.createOrganization,
      { ...details, documents },
    );

    const attached = await t.run((ctx) =>
      ctx.db
        .query("organizationDocuments")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId),
        )
        .collect(),
    );
    expect(attached).toHaveLength(REQUIRED.length);
    expect(await pendingRows(t)).toHaveLength(0);

    // Files that are attached survive the clean-up.
    later(25 * HOUR);
    await t.mutation(internal.documentUploads.sweepStaleDocumentUploads, {});
    for (const doc of documents) {
      expect(await inStorage(t, doc.storageId)).toBe(true);
    }
  });

  it("rejects a file that was never registered", async () => {
    const { t, asAlice } = await setup();
    const documents = [];
    for (const type of REQUIRED) documents.push(await registered(t, asAlice, type));
    // Uploaded, but skipped the registration step.
    documents[0] = { ...documents[0], storageId: await store(t) };

    await expect(
      asAlice.mutation(api.organizations.createOrganization, {
        ...details,
        documents,
      }),
    ).rejects.toThrow(/wasn't uploaded properly/);
    expect(await t.run((ctx) => ctx.db.query("organizations").collect())).toHaveLength(0);
  });

  it("rejects a file that another person registered", async () => {
    const { t, asAlice, asBob } = await setup();
    const documents = [];
    for (const type of REQUIRED) documents.push(await registered(t, asAlice, type));
    documents[1] = await registered(t, asBob, "PAYOUT_ACCOUNT_PROOF");

    await expect(
      asAlice.mutation(api.organizations.createOrganization, {
        ...details,
        documents,
      }),
    ).rejects.toThrow(/wasn't uploaded properly/);
  });

  it("keeps the files pending when the submission fails, so a retry works", async () => {
    const { t, asAlice } = await setup();
    const documents = [];
    for (const type of REQUIRED) documents.push(await registered(t, asAlice, type));

    await expect(
      asAlice.mutation(api.organizations.createOrganization, {
        ...details,
        documents: documents.slice(0, 3), // one required document missing
      }),
    ).rejects.toThrow(/Missing required documents/);
    expect(await pendingRows(t)).toHaveLength(REQUIRED.length);

    await expect(
      asAlice.mutation(api.organizations.createOrganization, {
        ...details,
        documents,
      }),
    ).resolves.toHaveProperty("organizationId");
    expect(await pendingRows(t)).toHaveLength(0);
  });
});
