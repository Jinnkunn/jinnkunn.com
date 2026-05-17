import Foundation
import Observation

@MainActor
@Observable
final class AppSession {
    var baseURLString: String = "https://staging.jinkunchen.com"
    var token: String?
    var login: String = ""
    var tokenExpiresAt: String = ""
    var summary: SiteAdminMobileSummary?
    var isLoading = false
    var message: String?

    @ObservationIgnored private let tokenStore = KeychainTokenStore(
        service: "com.jinkunchen.SiteAdminCompanion",
        account: "site-admin-token"
    )
    @ObservationIgnored private let authenticator = SiteAdminAuthenticator()

    init() {
        if let stored = tokenStore.load() {
            token = stored
        }
    }

    var isSignedIn: Bool {
        token?.isEmpty == false
    }

    var baseURL: URL? {
        URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    var client: SiteAdminClient? {
        guard let baseURL else { return nil }
        return SiteAdminClient(baseURL: baseURL, token: token)
    }

    func refresh() async {
        guard let client else {
            message = "Invalid Site Admin URL."
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            summary = try await client.summary()
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    func signIn() async {
        guard let baseURL else {
            message = "Invalid Site Admin URL."
            return
        }
        do {
            let result = try await authenticator.signIn(baseURL: baseURL)
            token = result.token
            login = result.login
            tokenExpiresAt = result.expiresAt
            try tokenStore.save(result.token)
            await refresh()
        } catch {
            message = error.localizedDescription
        }
    }

    func clearAuth() {
        token = nil
        login = ""
        tokenExpiresAt = ""
        summary = nil
        tokenStore.delete()
    }

    func updateNow(text: String, context: String, location: String) async -> Bool {
        guard let client else {
            message = "Invalid Site Admin URL."
            return false
        }
        isLoading = true
        defer { isLoading = false }
        do {
            try await client.updateNow(text: text, context: context, location: location)
            await refresh()
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func smartRelease() async {
        guard let client else {
            message = "Invalid Site Admin URL."
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            _ = try await client.smartRelease()
            await refresh()
        } catch {
            message = error.localizedDescription
        }
    }
}
