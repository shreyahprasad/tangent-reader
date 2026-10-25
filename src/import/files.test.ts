import { describe, expect, it } from "vitest";
import { decodeText, fileKind, titleFromFile } from "./files";

describe("files", () => {
  it("knows a file by its name, or by its type when the name says nothing", () => {
    expect(fileKind("Paper.PDF", "")).toBe("pdf");
    expect(fileKind("notes.md", "")).toBe("markdown");
    expect(fileKind("notes.markdown", "text/x-markdown")).toBe("markdown");
    expect(fileKind("notes.txt", "")).toBe("text");
    expect(fileKind("download", "application/pdf")).toBe("pdf");
    expect(fileKind("notes", "text/markdown")).toBe("markdown");
    expect(fileKind("notes", "text/plain")).toBe("text");
    expect(fileKind("photo.jpg", "image/jpeg")).toBeNull();
    expect(fileKind("book.epub", "application/epub+zip")).toBeNull();
  });

  it("reads UTF-8, without its byte order mark", () => {
    expect(decodeText(new TextEncoder().encode("﻿Café crème."))).toBe("Café crème.");
  });

  it("reads UTF-16 by its byte order mark, as older Notepad saves \"Unicode\"", () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00, 0xe9, 0x00]))).toBe("Hié");
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]))).toBe("Hi");
  });

  it("reads a file that is not UTF-8 as Windows-1252", () => {
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x6f, 0x6b, 0x94]))).toBe("Café “ok”");
  });

  it("titles a file by its metadata title", () => {
    expect(titleFromFile("attention.pdf", "Attention Is All You Need")).toBe("Attention Is All You Need");
    expect(titleFromFile("attention.pdf", "  Attention  ")).toBe("Attention");
  });

  it("uses a short first paragraph that reads as a heading, when there is no real metadata title", () => {
    expect(titleFromFile("2401.00023v2.pdf", "", "CycleGAN Models for MRI Image Translation")).toBe("CycleGAN Models for MRI Image Translation");
    expect(titleFromFile("notes.pdf", "Untitled", "How Rivers Keep Time")).toBe("How Rivers Keep Time");
    expect(titleFromFile("notes.pdf", "A Real Title", "How Rivers Keep Time")).toBe("A Real Title");
    // A sentence, a single word or a long first paragraph is not a heading.
    for (const first of ["Rivers carve canyons.", "Abstract", "x ".repeat(80).trim(), "Dear reader,"]) {
      expect(titleFromFile("notes.pdf", null, first), first).toBe("notes");
    }
  });

  it("uses the file name, less its extension, when the metadata title is missing or junk", () => {
    expect(titleFromFile("arxiv-1706.03762.pdf", "")).toBe("arxiv-1706.03762");
    expect(titleFromFile("notes.md")).toBe("notes");
    expect(titleFromFile("2401.00018")).toBe("2401.00018"); // a PDF from a link, with no extension
    for (const junk of ["Untitled", "untitled document", "Microsoft Word - draft3.docx", "draft3.docx", "Document1", "Slide 1", "paper.pdf", "arxiv-1706.03762"]) {
      expect(titleFromFile("arxiv-1706.03762.pdf", junk), junk).toBe("arxiv-1706.03762");
    }
  });
});
