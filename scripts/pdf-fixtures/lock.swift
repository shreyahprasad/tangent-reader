// Locks a PDF with a password (a made-up one: the fixture only needs to be locked), and can cut a
// PDF to its first pages: swift lock.swift in.pdf out.pdf [--first N]
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("usage: lock.swift in.pdf out.pdf [--first N]\n".data(using: .utf8)!)
  exit(1)
}
let out = URL(fileURLWithPath: args[2])
if args.count == 5, args[3] == "--first", let n = Int(args[4]) {
  while doc.pageCount > n { doc.removePage(at: doc.pageCount - 1) }
  exit(doc.write(to: out) ? 0 : 1)
}
let options: [PDFDocumentWriteOption: Any] = [.userPasswordOption: "made-up", .ownerPasswordOption: "made-up-owner"]
exit(doc.write(to: out, withOptions: options) ? 0 : 1)
