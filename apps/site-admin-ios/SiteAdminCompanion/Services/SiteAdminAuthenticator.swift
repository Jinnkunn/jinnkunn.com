import AuthenticationServices
import Foundation
import UIKit

@MainActor
final class SiteAdminAuthenticator: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var activeSession: ASWebAuthenticationSession?

    func signIn(baseURL: URL) async throws -> AuthResult {
        let state = UUID().uuidString
        let callback = "jinnkunn-site-admin://auth/callback"
        guard var components = URLComponents(
            url: URL(string: "/api/site-admin/app-auth/authorize", relativeTo: baseURL)!.absoluteURL,
            resolvingAgainstBaseURL: false
        ) else {
            throw SiteAdminClientError.invalidBaseURL
        }
        components.queryItems = [
            URLQueryItem(name: "redirect_uri", value: callback),
            URLQueryItem(name: "state", value: state),
        ]
        guard let authURL = components.url else {
            throw SiteAdminClientError.invalidBaseURL
        }

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "jinnkunn-site-admin"
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let callbackURL,
                      let result = Self.parseCallback(callbackURL, expectedState: state) else {
                    continuation.resume(throwing: SiteAdminClientError.invalidResponse)
                    return
                }
                continuation.resume(returning: result)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            activeSession = session
            session.start()
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }

    private static func parseCallback(_ url: URL, expectedState: String) -> AuthResult? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let values = Dictionary(
            uniqueKeysWithValues: (components.queryItems ?? []).map {
                ($0.name, $0.value ?? "")
            }
        )
        guard values["state"] == expectedState,
              let token = values["token"], !token.isEmpty else {
            return nil
        }
        return AuthResult(
            token: token,
            login: values["login"] ?? "",
            expiresAt: values["expiresAt"] ?? ""
        )
    }
}
