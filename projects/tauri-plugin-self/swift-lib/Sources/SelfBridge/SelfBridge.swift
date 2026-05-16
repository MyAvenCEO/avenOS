import CryptoKit
import Darwin
import Foundation
@preconcurrency import LocalAuthentication
import SwiftRs

// MARK: - Result objects (matched on the Rust side via #[repr(C)])

@objcMembers
public class CreateKeyResultObject: NSObject {
	public let blob: SRData
	public let publicKey: SRData

	public init(blob: Data, publicKey: Data) {
		self.blob = SRData([UInt8](blob))
		self.publicKey = SRData([UInt8](publicKey))
	}
}

@objcMembers
public class DeriveSecretResultObject: NSObject {
	public let secret: SRData

	public init(secret: Data) {
		self.secret = SRData([UInt8](secret))
	}
}

// MARK: - Helpers

public typealias SelfResultCallback = @convention(c) (
	UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UInt64
) -> Void

private func dupCString(_ message: String) -> UnsafePointer<CChar> {
	message.withCString { ptr in
		UnsafePointer(strdup(ptr)!)
	}
}

/// Required SE ACL: `.privateKeyUsage` (Apple-required for SE keys) + `.biometryCurrentSet` (re-enrolment invalidates).
private func secureEnclaveKeyAccessControl() throws -> SecAccessControl {
	var cfErr: Unmanaged<CFError>?
	let flags: SecAccessControlCreateFlags = [.privateKeyUsage, .biometryCurrentSet]
	guard
		let ac = SecAccessControlCreateWithFlags(
			nil,
			kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
			flags,
			&cfErr
		)
	else {
		let msg =
			cfErr?.takeRetainedValue().localizedDescription
			?? "SecAccessControlCreateWithFlags returned nil"
		throw NSError(domain: "SelfBridge", code: 1, userInfo: [NSLocalizedDescriptionKey: msg])
	}
	return ac
}

// MARK: - Bridge entry points (synchronous: SE creation + public-key derivation)

/// Generates a fresh Secure Enclave P-256 key. Returns blob (opaque, SE-wrapped) and 65-byte uncompressed SEC1 public point.
/// Synchronous: no biometric prompt — SE creation alone never prompts; first *use* will.
@_cdecl("self_create_se_key_bridge")
public func self_create_se_key_bridge(
	context: UInt64,
	callback: @escaping SelfResultCallback
) {
	do {
		let ac = try secureEnclaveKeyAccessControl()
		let priv = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: ac)
		let blob = priv.dataRepresentation
		let pub = priv.publicKey.x963Representation

		let result = CreateKeyResultObject(blob: blob, publicKey: pub)
		let ptr = Unmanaged.passRetained(result).toOpaque()
		callback(ptr, nil, context)
	} catch {
		callback(nil, dupCString((error as NSError).localizedDescription), context)
	}
}

/// Loads SE handle from blob and asks the SE to perform ECDH against `peerPub`, then HKDF-extracts 32 bytes.
/// Exactly **one** Touch ID sheet via `LAContext.evaluatePolicy(...)`; the same authenticated context is reused for
/// the SE key load + ECDH, so the SE does not re-prompt.
@_cdecl("self_derive_root_secret_bridge")
public func self_derive_root_secret_bridge(
	blob: SRData,
	peerPub: SRData,
	reason: SRString,
	context: UInt64,
	callback: @escaping SelfResultCallback
) {
	let blobData = Data(blob.toArray())
	let peerData = Data(peerPub.toArray())
	let reasonStr = reason.toString()

	if blobData.isEmpty {
		callback(nil, dupCString("missing_se_blob"), context)
		return
	}
	if peerData.isEmpty {
		callback(nil, dupCString("missing_genesis_network_id"), context)
		return
	}

	let ctx = LAContext()
	ctx.localizedReason = reasonStr

	ctx.evaluatePolicy(
		.deviceOwnerAuthenticationWithBiometrics,
		localizedReason: reasonStr
	) { success, lerror in
		if !success {
			let msg = lerror?.localizedDescription ?? "biometry_failed"
			callback(nil, dupCString(msg), context)
			return
		}

		do {
			let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(
				dataRepresentation: blobData,
				authenticationContext: ctx
			)
			let peer = try P256.KeyAgreement.PublicKey(x963Representation: peerData)
			let secret = try key.sharedSecretFromKeyAgreement(with: peer)

			let sym = secret.hkdfDerivedSymmetricKey(
				using: SHA256.self,
				salt: peerData,
				sharedInfo: Data("ceo.aven.os/root/v1".utf8),
				outputByteCount: 32
			)
			let out = sym.withUnsafeBytes { Data($0) }

			let result = DeriveSecretResultObject(secret: out)
			let ptr = Unmanaged.passRetained(result).toOpaque()
			callback(ptr, nil, context)
		} catch {
			callback(nil, dupCString((error as NSError).localizedDescription), context)
		}
	}
}

/// Pure derivation: load SE handle from blob (does not prompt) and read the public point.
/// Used as a defensive fallback if the cached pub file is missing; normal reads should hit the cache file directly.
@_cdecl("self_public_key_from_blob_bridge")
public func self_public_key_from_blob_bridge(blob: SRData) -> SRData {
	let blobData = Data(blob.toArray())
	if blobData.isEmpty { return SRData([]) }
	do {
		let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: blobData)
		return SRData([UInt8](key.publicKey.x963Representation))
	} catch {
		return SRData([])
	}
}
