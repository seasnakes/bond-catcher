#!/usr/bin/env swift

import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let inputURL = root.appendingPathComponent("data/convertible-bond-tags.json")
let outputURL = root.appendingPathComponent("data/convertible-bond-search-aliases.json")

func latinParts(_ value: String) -> [String] {
    let latin = value.applyingTransform(.toLatin, reverse: false) ?? value
    let stripped = latin.applyingTransform(.stripDiacritics, reverse: false) ?? latin
    return stripped
        .lowercased()
        .components(separatedBy: CharacterSet.alphanumerics.inverted)
        .filter { !$0.isEmpty }
}

func searchAliases(_ value: String) -> [String] {
    let parts = latinParts(value)
    guard !parts.isEmpty else { return [] }
    let full = parts.joined()
    let initials = parts.compactMap(\.first).map(String.init).joined()
    return full == initials ? [full] : [full, initials]
}

let inputData = try Data(contentsOf: inputURL)
guard let payload = try JSONSerialization.jsonObject(with: inputData) as? [String: Any],
      let rows = payload["rows"] as? [[String: Any]] else {
    throw NSError(domain: "BondSearchAliases", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "convertible-bond-tags.json 缺少 rows",
    ])
}

var aliases: [String: [String]] = [:]
for row in rows {
    guard let code = row["code"] as? String, !code.isEmpty else { continue }
    let values = [row["name"] as? String, row["stockName"] as? String].compactMap { $0 }
    var seen = Set<String>()
    aliases[code] = values
        .flatMap(searchAliases)
        .filter { seen.insert($0).inserted }
}

let output: [String: Any] = [
    "asOf": payload["asOf"] as? String ?? "",
    "count": aliases.count,
    "aliases": aliases,
]
let outputData = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
try outputData.write(to: outputURL, options: .atomic)
print("已生成 \(aliases.count) 只转债的全拼与首字母搜索索引：\(outputURL.path)")
