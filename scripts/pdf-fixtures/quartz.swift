// Prints a text file to PDF through AppKit and Quartz, as TextEdit or Pages would, wrapping at
// words: swift quartz.swift in.txt out.pdf
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let text = try? String(contentsOfFile: args[1], encoding: .utf8) else {
  FileHandle.standardError.write("usage: quartz.swift in.txt out.pdf\n".data(using: .utf8)!)
  exit(1)
}
let info = NSPrintInfo()
info.paperSize = NSSize(width: 612, height: 792)
info.topMargin = 72
info.bottomMargin = 72
info.leftMargin = 72
info.rightMargin = 72
info.jobDisposition = .save
info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = URL(fileURLWithPath: args[2])

let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 468, height: 648))
let style = NSMutableParagraphStyle()
style.paragraphSpacing = 10
view.textStorage?.setAttributedString(NSAttributedString(string: text, attributes: [.font: NSFont(name: "Helvetica", size: 12)!, .paragraphStyle: style]))
// Tall enough for all the text, so printing splits it into pages instead of clipping it.
view.isVerticallyResizable = true
view.textContainer?.containerSize = NSSize(width: 468, height: CGFloat.greatestFiniteMagnitude)
view.layoutManager?.ensureLayout(for: view.textContainer!)
view.sizeToFit()
let print = NSPrintOperation(view: view, printInfo: info)
print.showsPrintPanel = false
print.showsProgressPanel = false
exit(print.run() ? 0 : 1)
