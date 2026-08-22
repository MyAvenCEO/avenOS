import AuthenticationServices
import Foundation
import Tauri
import UIKit

private struct LoginArgs: Decodable {
  let domain: String
  let challenge: [UInt8]
}

final class IosPasskeyPlugin: Plugin, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private var controller: ASAuthorizationController?
  private var pending: Invoke?
  private var anchor: UIWindow?

  @objc func login(_ invoke: Invoke) throws {
    guard #available(iOS 16.0, *) else {
      invoke.reject("NATIVE_PASSKEY_UNAVAILABLE: Native passkeys require iOS 16 or later.")
      return
    }

    do {
      let args = try invoke.parseArgs(LoginArgs.self)
      guard args.domain == "id.next.aven.ceo" else {
        invoke.reject("Native passkeys are restricted to id.next.aven.ceo.")
        return
      }

      DispatchQueue.main.async {
        guard self.pending == nil else {
          invoke.reject("A native passkey request is already active.")
          return
        }
        guard let anchor = self.activeWindow() else {
          invoke.reject("NATIVE_PASSKEY_UNAVAILABLE: No application window can present passkeys.")
          return
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
          relyingPartyIdentifier: args.domain)
        let request = provider.createCredentialAssertionRequest(
          challenge: Data(args.challenge))
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.anchor = anchor
        self.controller = controller
        self.pending = invoke
        controller.performRequests()
      }
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  // No @available here, deliberately. This delegate method dates back to
  // iOS 13, and Swift refuses a witness that is less available than the
  // requirement it satisfies — annotating it iOS 16 fails the build outright.
  // The version gate belongs around the passkey types inside, which are the
  // part that actually needs iOS 16.
  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    defer { clearPending() }
    guard #available(iOS 16.0, *) else {
      pending?.reject("NATIVE_PASSKEY_UNAVAILABLE: Native passkeys require iOS 16 or later.")
      return
    }
    guard
      let credential = authorization.credential
        as? ASAuthorizationPlatformPublicKeyCredentialAssertion,
      let invoke = pending
    else {
      pending?.reject("Apple did not return a passkey assertion.")
      return
    }

    invoke.resolve([
      "id": credential.credentialID.base64UrlEncodedString(),
      "raw_id": credential.credentialID.base64UrlEncodedString(),
      "client_data_json": credential.rawClientDataJSON.base64UrlEncodedString(),
      "authenticator_data": credential.rawAuthenticatorData.base64UrlEncodedString(),
      "signature": credential.signature.base64UrlEncodedString(),
      "user_handle": credential.userID.base64UrlEncodedString(),
    ])
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithError error: Error
  ) {
    pending?.reject(Self.describe(error))
    clearPending()
  }

  /// iOS validates `webcredentials:` associated domains per install through
  /// Apple's AASA CDN (swcd). When that validation has not (yet) succeeded on
  /// this device — stale cache, failed fetch, first install before the host was
  /// live — every native request fails with ASAuthorizationError 1004
  /// "Application with identifier … is not associated with domain …". The
  /// passkey itself is fine; only this device's association state is. Surface
  /// it under the NATIVE_PASSKEY_UNAVAILABLE contract so the gate falls back to
  /// the browser device-code flow instead of dead-ending on "retry".
  private static func describe(_ error: Error) -> String {
    let detail = error.localizedDescription
    let nsError = error as NSError
    let isAssociationFailure =
      nsError.domain == ASAuthorizationError.errorDomain
      && nsError.code == ASAuthorizationError.failed.rawValue
      && detail.localizedCaseInsensitiveContains("not associated with domain")
    if isAssociationFailure {
      return "NATIVE_PASSKEY_UNAVAILABLE: This device has not verified the passkey domain yet (\(detail)). Reinstalling the app refreshes Apple's associated-domain check."
    }
    return detail
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    anchor ?? UIWindow()
  }

  private func activeWindow() -> UIWindow? {
    manager.viewController?.view.window
      ?? UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow })
  }

  private func clearPending() {
    controller = nil
    pending = nil
    anchor = nil
  }
}

private extension Data {
  func base64UrlEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

@_cdecl("init_plugin_ios_passkey")
func initPlugin() -> Plugin {
  IosPasskeyPlugin()
}
