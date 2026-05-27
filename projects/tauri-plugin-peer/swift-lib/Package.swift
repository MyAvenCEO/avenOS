// swift-tools-version: 6.1

import PackageDescription

let package = Package(
	name: "NetworkPathBridge",
	platforms: [
		.macOS(.v13),
		.iOS(.v14),
	],
	products: [
		.library(name: "NetworkPathBridge", type: .static, targets: ["NetworkPathBridge"]),
	],
	dependencies: [
		.package(url: "https://github.com/Brendonovich/swift-rs", from: "1.0.5"),
	],
	targets: [
		.target(
			name: "NetworkPathBridge",
			dependencies: [
				.product(name: "SwiftRs", package: "swift-rs"),
			],
			linkerSettings: [
				.linkedFramework("Network"),
			]
		),
	]
)
