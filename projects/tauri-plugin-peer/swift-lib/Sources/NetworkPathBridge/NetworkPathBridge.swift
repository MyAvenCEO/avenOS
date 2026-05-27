import Foundation
import Network
import SwiftRs
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

private final class BridgeState: @unchecked Sendable {
	var pathMonitor: NWPathMonitor?
	var pathQueue: DispatchQueue?
	var pathCallback: (@convention(c) (UInt8, UInt8, UInt8, SRString, UInt64) -> Void)?
	var pathContext: UInt64 = 0
	var foregroundCallback: (@convention(c) (UInt64) -> Void)?
	var foregroundContext: UInt64 = 0
}

private let state = BridgeState()

private func interfaceNames(from path: NWPath) -> String {
	var names: [String] = []
	if path.usesInterfaceType(.wifi) { names.append("wifi") }
	if path.usesInterfaceType(.cellular) { names.append("cellular") }
	if path.usesInterfaceType(.wiredEthernet) { names.append("wired") }
	if path.usesInterfaceType(.loopback) { names.append("loopback") }
	if path.usesInterfaceType(.other) { names.append("other") }
	return names.joined(separator: ",")
}

private func emitPath(_ path: NWPath) {
	guard let cb = state.pathCallback else { return }
	let satisfied: UInt8 = path.status == .satisfied ? 1 : 0
	let expensive: UInt8 = path.isExpensive ? 1 : 0
	let constrained: UInt8 = path.isConstrained ? 1 : 0
	cb(satisfied, expensive, constrained, SRString(interfaceNames(from: path)), state.pathContext)
}

private func registerForegroundObserver() {
	#if os(iOS)
	NotificationCenter.default.addObserver(
		forName: UIApplication.didBecomeActiveNotification,
		object: nil,
		queue: .main
	) { _ in
		state.foregroundCallback?(state.foregroundContext)
	}
	#elseif os(macOS)
	NotificationCenter.default.addObserver(
		forName: NSApplication.didBecomeActiveNotification,
		object: nil,
		queue: .main
	) { _ in
		state.foregroundCallback?(state.foregroundContext)
	}
	#endif
}

@_cdecl("network_path_start_monitor")
public func network_path_start_monitor(
	pathCb: @escaping @convention(c) (UInt8, UInt8, UInt8, SRString, UInt64) -> Void,
	pathCtx: UInt64,
	foregroundCb: @escaping @convention(c) (UInt64) -> Void,
	foregroundCtx: UInt64
) {
	state.pathCallback = pathCb
	state.pathContext = pathCtx
	state.foregroundCallback = foregroundCb
	state.foregroundContext = foregroundCtx

	let monitor = NWPathMonitor()
	state.pathMonitor = monitor
	let queue = DispatchQueue(label: "avenos.network-path", qos: .utility)
	state.pathQueue = queue

	monitor.pathUpdateHandler = { path in
		emitPath(path)
	}
	monitor.start(queue: queue)
	emitPath(monitor.currentPath)
	registerForegroundObserver()
}

@_cdecl("network_path_stop_monitor")
public func network_path_stop_monitor() {
	state.pathMonitor?.cancel()
	state.pathMonitor = nil
	state.pathQueue = nil
	state.pathCallback = nil
	state.foregroundCallback = nil
}
