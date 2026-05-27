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
	targets: [
		.target(
			name: "NetworkPathBridge",
			dependencies: [],
			linkerSettings: [
				.linkedFramework("Network"),
			]
		),
	]
)
