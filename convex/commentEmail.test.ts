import { describe, expect, it } from "vitest";
import {
  buildCommentEmail,
  commentCountLabel,
  type CommentEmailData,
} from "./lib/commentEmail";
import { SITE_URL } from "../lib/site";

const data: CommentEmailData = {
  fundraiserId: "k17abc",
  fundraiserTitle: "Water for Kajiado",
  organizerName: "Grace Wanjiku",
  count: 3,
  hasMore: false,
  token: "tok_abc-123",
};

describe("the comment count in words", () => {
  it("says one, many, and more than it counted", () => {
    expect(commentCountLabel(1, false)).toBe("1 new comment");
    expect(commentCountLabel(2, false)).toBe("2 new comments");
    expect(commentCountLabel(100, false)).toBe("100 new comments");
    expect(commentCountLabel(100, true)).toBe("100+ new comments");
    // Even one, if the count was cut short, is not exactly one.
    expect(commentCountLabel(1, true)).toBe("1+ new comments");
  });
});

describe("the comment email", () => {
  it("says how many comments there are and where to read them", () => {
    const email = buildCommentEmail(data);

    expect(email.subject).toBe("3 new comments on Water for Kajiado");
    const readUrl = `${SITE_URL}/fundraiser/k17abc#comments`;
    expect(email.html).toContain(readUrl);
    expect(email.text).toContain(`Read the comments: ${readUrl}`);
    expect(email.text).toContain("Donors have left 3 new comments");
  });

  it("is written in the singular for one comment", () => {
    const email = buildCommentEmail({ ...data, count: 1 });
    expect(email.subject).toBe("1 new comment on Water for Kajiado");
    expect(email.text).toContain("A donor has left a new comment");
    expect(email.html).toContain("A donor has left a new comment on");
  });

  it("says 100+ when the count was cut off", () => {
    const email = buildCommentEmail({ ...data, count: 100, hasMore: true });
    expect(email.subject).toBe("100+ new comments on Water for Kajiado");
    expect(email.text).toContain("100+ new comments");
  });

  it("greets the organizer by first name, or plainly without one", () => {
    expect(buildCommentEmail(data).text.startsWith("Hello Grace,")).toBe(true);
    for (const name of [null, "", "   "]) {
      const email = buildCommentEmail({ ...data, organizerName: name });
      expect(email.text.startsWith("Hello,")).toBe(true);
      expect(email.html).not.toMatch(/Hello null|Hello undefined/);
    }
  });

  it("is built to carry no comment text and no donor names", () => {
    // The data has nowhere to put what a comment says or who wrote it, and
    // that is the point: the email comes from us, so a stranger's words must
    // not ride in it.
    const keys = Object.keys(data);
    for (const key of ["body", "comment", "comments", "authorName", "donor"]) {
      expect(keys).not.toContain(key);
    }
  });

  it("has a link to unsubscribe, built from the recipient's token", () => {
    const email = buildCommentEmail(data);
    const link = `${SITE_URL}/unsubscribe/comments/tok_abc-123`;
    expect(email.html).toContain(link);
    expect(email.text).toContain(link);
    expect(email.text).toMatch(/at most one of these a day/);
  });

  it("tells the organizer they can hide a comment", () => {
    expect(buildCommentEmail(data).text).toMatch(/hide any comment/);
  });

  it("escapes a title that is made of markup", () => {
    const email = buildCommentEmail({
      ...data,
      fundraiserTitle: `Water <script>alert(1)</script> & "more"`,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp;");
  });

  it("keeps the subject to one line of sensible length", () => {
    const email = buildCommentEmail({
      ...data,
      fundraiserTitle: `Line one\r\nBcc: someone@example.test\n${"long ".repeat(80)}`,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeLessThanOrEqual(
      "3 new comments on ".length + 70,
    );
  });

  it("falls back to plain words when the title is empty", () => {
    const email = buildCommentEmail({ ...data, fundraiserTitle: "   " });
    expect(email.subject).toBe("3 new comments on your fundraiser");
  });

  it("adds the one-click unsubscribe headers when it has an address for them", () => {
    const email = buildCommentEmail(data, {
      oneClickUrl:
        "https://example-123.convex.site/email/unsubscribe-comments/tok",
    });
    expect(email.headers).toEqual({
      "List-Unsubscribe":
        "<https://example-123.convex.site/email/unsubscribe-comments/tok>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("sends no unsubscribe headers rather than a broken one", () => {
    expect(buildCommentEmail(data).headers).toEqual({});
    expect(buildCommentEmail(data, { oneClickUrl: null }).headers).toEqual({});
  });

  it("uses the site address it is given, without doubling the slash", () => {
    const email = buildCommentEmail(data, { siteUrl: "https://preview.test/" });
    expect(email.text).toContain(
      "https://preview.test/fundraiser/k17abc#comments",
    );
    expect(email.text).toContain(
      "https://preview.test/unsubscribe/comments/tok_abc-123",
    );
    expect(email.text).not.toContain("//fundraiser");
  });
});
