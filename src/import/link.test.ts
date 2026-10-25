import { describe, expect, it } from "vitest";
import { archiveHelps, archiveLink, cleanLink, failureMessage, looksLikeArticle, normalizeLink } from "./link";

describe("links", () => {
  it("takes a link as typed, adding https:// to a bare address", () => {
    expect(normalizeLink("  https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(normalizeLink("example.com/essay")).toBe("https://example.com/essay");
    expect(normalizeLink("www.example.co.uk")).toBe("https://www.example.co.uk/");
    expect(normalizeLink("http://example.com")).toBe("http://example.com/");
  });

  it("refuses what is not a web link", () => {
    for (const input of ["", "   ", "just some words", "ftp://example.com/x", "javascript:alert(1)", "mailto:a@b.c", "file:///etc/passwd", "localhost"]) {
      expect(normalizeLink(input), input).toBeNull();
    }
  });

  it("drops tracking from the link it keeps, and nothing else", () => {
    expect(cleanLink("https://example.com/a?utm_source=x&utm_medium=y&id=7&fbclid=z&gclid=q#part")).toBe("https://example.com/a?id=7#part");
    expect(cleanLink("https://example.com/a?utm_campaign=only")).toBe("https://example.com/a");
    expect(cleanLink("https://example.com/a?page=2")).toBe("https://example.com/a?page=2");
  });

  it("says why a link could not be read, in words for you", () => {
    expect(failureMessage({ error: "refused", status: 403 })).toBe(
      "That site turned Tangent away (error 403). Some sites only show their articles in a browser, or to subscribers. Copy the text and paste it instead.",
    );
    expect(failureMessage({ error: "blocked" })).toBe("Tangent won't fetch that address: it points inside a private network.");
    expect(failureMessage({ error: "too_big", limit: "2 MB" })).toBe("That page is too big to read: over 2 MB.");
    expect(failureMessage({ error: "rate_limited" })).toBe("That's a lot of links at once. Wait a minute, then try again.");
  });

  it("offers the Internet Archive's copy only where it may help", () => {
    expect(archiveLink("https://news.example/story?id=7")).toBe("https://web.archive.org/web/https://news.example/story?id=7");
    for (const error of ["refused", "timeout", "unreachable", "too_many_redirects"] as const) {
      expect(archiveHelps(error === "refused" ? { error, status: 403 } : { error }), error).toBe(true);
    }
    for (const error of ["bad_link", "blocked", "no_such_site", "rate_limited", "port"] as const) expect(archiveHelps({ error }), error).toBe(false);
  });

  it("tells an article from a home page or a list of links", () => {
    const essay = Array.from({ length: 12 }, () => "A paragraph of an essay that runs on for a while, as essays do. ".repeat(4));
    expect(looksLikeArticle({ paragraphs: essay, linkChars: 0 })).toBe(true);
    // Headlines: short paragraphs.
    expect(looksLikeArticle({ paragraphs: Array.from({ length: 40 }, () => "A headline about something"), linkChars: 0 })).toBe(false);
    // Mostly links.
    expect(looksLikeArticle({ paragraphs: essay, linkChars: essay.join("").length * 0.6 })).toBe(false);
    // Too short to be an article.
    expect(looksLikeArticle({ paragraphs: ["Sign in to continue reading this article on our app."], linkChars: 0 })).toBe(false);
  });
});
