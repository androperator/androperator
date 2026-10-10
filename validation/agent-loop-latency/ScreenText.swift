import Foundation
import Vision

// Local-only pixel inspection for the physical Settings experiment.
let request = VNRecognizeTextRequest()
request.usesCPUOnly = true
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1])).perform([request])
let rows = (request.results ?? []).compactMap { observation -> [String: Any]? in
    guard let text = observation.topCandidates(1).first else { return nil }
    return ["text": text.string, "confidence": text.confidence,
            "top": 1 - observation.boundingBox.maxY, "left": observation.boundingBox.minX]
}
let data = try JSONSerialization.data(withJSONObject: rows)
print(String(data: data, encoding: .utf8)!)
