// swift-tools-version: 6.1

import PackageDescription

let package = Package(
	name: "SelfBridge",
	platforms: [
		.macOS(.v13),
		.iOS(.v14),
	],
	products: [
		.library(name: "SelfBridge", type: .static, targets: ["SelfBridge"]),
	],
	dependencies: [
		.package(url: "https://github.com/Brendonovich/swift-rs", from: "1.0.5"),
	],
	targets: [
		.target(
			name: "SelfBridge",
			dependencies: [
				.product(name: "SwiftRs", package: "swift-rs"),
			],
			linkerSettings: [
				.linkedFramework("CryptoKit"),
				.linkedFramework("Security"),
			]
		),
	]
)
