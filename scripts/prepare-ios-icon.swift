// Resize the existing extension artwork onto an opaque backing required by iOS.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = URL(fileURLWithPath: CommandLine.arguments[2])
guard let input = CGImageSourceCreateWithURL(source as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(input, 0, nil),
      let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 4096, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw CocoaError(.fileReadCorruptFile) }
context.setFillColor(CGColor(red: 24/255, green: 25/255, blue: 28/255, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.interpolationQuality = .high
context.draw(image, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
guard let result = context.makeImage(), let output = CGImageDestinationCreateWithURL(destination as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw CocoaError(.fileWriteUnknown) }
CGImageDestinationAddImage(output, result, nil)
guard CGImageDestinationFinalize(output) else { throw CocoaError(.fileWriteUnknown) }
