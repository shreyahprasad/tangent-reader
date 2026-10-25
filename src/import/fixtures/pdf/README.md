# PDF fixtures

PDFs for `pdf.test.ts` and the import e2e tests. None of them is anyone's own reading.

## Made up

Printed from `scripts/pdf-fixtures/essay.txt`, an essay written for this repo, by the tools real
PDFs come from. `scripts/pdf-fixtures/make.mjs` makes them again on a Mac.

| File | Made by | What it tests |
|---|---|---|
| `chrome-essay.pdf` | Chrome (Skia), as Google Docs and browsers print | A running header, a numbered footer, hyphenated line breaks, 4 pages |
| `chrome-columns.pdf` | Chrome, CSS columns | Two columns read in order |
| `quartz-notes.pdf` | macOS AppKit and Quartz, as TextEdit and Pages print | Ligatures as separate pieces, a paragraph across a page break, the metadata title "Untitled" |
| `scanned.pdf` | Chrome, printing two pictures of text | A PDF with no text layer |
| `locked.pdf` | PDFKit, from `quartz-notes.pdf` | A PDF that asks for a password ("made-up") |

## From arXiv, under CC BY 4.0

Real LaTeX output, used under the Creative Commons Attribution 4.0 licence
(https://creativecommons.org/licenses/by/4.0/).

- `arxiv-2401.00023.pdf`: Cassandra Czobit and Reza Samavi, "CycleGAN Models for MRI Image
  Translation", arXiv:2401.00023 (https://arxiv.org/abs/2401.00023). Unchanged.
- `arxiv-2401.00018-pages-1-3.pdf`: Songlin Yang, Liang Du and Li Huang, "Combining Bayesian
  reconstruction entropy with maximum entropy method for analytic continuations of matrix-valued
  Green's functions", arXiv:2401.00018 (https://arxiv.org/abs/2401.00018). Changed: cut to its
  first 3 pages with `scripts/pdf-fixtures/lock.swift --first 3`, to keep the repo small.
