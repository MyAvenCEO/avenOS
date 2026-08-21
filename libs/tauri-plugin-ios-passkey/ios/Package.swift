// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-ios-passkey",
  platforms: [.iOS(.v16)],
  products: [
    .library(
      name: "tauri-plugin-ios-passkey",
      type: .static,
      targets: ["tauri-plugin-ios-passkey"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-ios-passkey",
      dependencies: [.byName(name: "Tauri")],
      path: "Sources")
  ]
)
