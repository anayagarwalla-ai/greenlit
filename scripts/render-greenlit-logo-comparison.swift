import AppKit
import Foundation

let projectRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = projectRoot.appendingPathComponent("artifacts/brand/greenlit-approved-source.png")
let logoURL = projectRoot.appendingPathComponent("apps/web/public/brand/greenlit-logo.png")
let implementationURL = projectRoot.appendingPathComponent("artifacts/brand/qa-home-desktop.png")
let destinationURL = projectRoot.appendingPathComponent("artifacts/brand/qa-source-vs-implementation.png")

guard
  let source = NSImage(contentsOf: sourceURL),
  let logo = NSImage(contentsOf: logoURL),
  let implementation = NSImage(contentsOf: implementationURL)
else {
  fputs("Required QA image is missing.\n", stderr)
  exit(1)
}

let canvasSize = NSSize(width: 2400, height: 1500)
let canvas = NSImage(size: canvasSize)
canvas.lockFocus()

NSColor(calibratedRed: 247 / 255, green: 244 / 255, blue: 236 / 255, alpha: 1).setFill()
NSRect(origin: .zero, size: canvasSize).fill()

let labelStyle: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 34, weight: .bold),
  .foregroundColor: NSColor(calibratedRed: 16 / 255, green: 35 / 255, blue: 29 / 255, alpha: 1),
]

func label(_ text: String, x: CGFloat, y: CGFloat) {
  text.draw(at: NSPoint(x: x, y: y), withAttributes: labelStyle)
}

label("APPROVED SOURCE", x: 80, y: 1415)
label("IMPLEMENTED DESKTOP HEADER", x: 1260, y: 1415)
source.draw(in: NSRect(x: 80, y: 790, width: 1060, height: 530))
implementation.draw(in: NSRect(x: 1260, y: 570, width: 1080, height: 750))

label("SOURCE LOCKUP — FOCUSED", x: 80, y: 505)
label("RENDERED LOCKUP — FOCUSED", x: 1260, y: 505)
NSColor.white.setFill()
NSRect(x: 80, y: 70, width: 1060, height: 360).fill()
NSRect(x: 1260, y: 70, width: 1060, height: 360).fill()
logo.draw(in: NSRect(x: 110, y: 138, width: 1000, height: 225))

let implementationHeader = NSRect(
  x: 70,
  y: max(0, implementation.size.height - 100),
  width: min(360, implementation.size.width - 70),
  height: min(100, implementation.size.height)
)
implementation.draw(
  in: NSRect(x: 1320, y: 125, width: 900, height: 250),
  from: implementationHeader,
  operation: .sourceOver,
  fraction: 1
)

canvas.unlockFocus()

guard
  let tiff = canvas.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiff),
  let png = bitmap.representation(using: .png, properties: [:])
else {
  fputs("Could not render the QA comparison.\n", stderr)
  exit(1)
}

try png.write(to: destinationURL)
print(destinationURL.path)
