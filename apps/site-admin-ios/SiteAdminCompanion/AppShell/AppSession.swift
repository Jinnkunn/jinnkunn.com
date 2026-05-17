import Foundation
import Observation

enum SiteAdminEnvironment: String, CaseIterable, Identifiable {
    case staging
    case production

    var id: String { rawValue }

    var name: String {
        switch self {
        case .staging:
            return "Draft"
        case .production:
            return "Live"
        }
    }

    var technicalName: String {
        switch self {
        case .staging:
            return "Staging"
        case .production:
            return "Production"
        }
    }

    var subtitle: String {
        switch self {
        case .staging:
            return "Edit and preview before publishing."
        case .production:
            return "Published site, read-only for edits."
        }
    }

    var canEditContent: Bool {
        self == .staging
    }

    var baseURLString: String {
        switch self {
        case .staging:
            return "https://staging.jinkunchen.com"
        case .production:
            return "https://jinkunchen.com"
        }
    }
}

@MainActor
@Observable
final class AppSession {
    var environment: SiteAdminEnvironment = .staging
    var baseURLString: String = SiteAdminEnvironment.staging.baseURLString
    var token: String?
    var login: String = ""
    var tokenExpiresAt: String = ""
    var summary: SiteAdminMobileSummary?
    var releaseDetail: ReleaseJobDetailPayload?
    var isLoading = false
    var isReleaseDetailLoading = false
    var message: String?

    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private let keychainService = "com.jinkunchen.SiteAdminCompanion"
    @ObservationIgnored private let legacyTokenStore = KeychainTokenStore(
        service: "com.jinkunchen.SiteAdminCompanion",
        account: "site-admin-token"
    )
    @ObservationIgnored private let authenticator = SiteAdminAuthenticator()
    @ObservationIgnored private let environmentKey = "site-admin-environment"
    @ObservationIgnored private let baseURLKey = "site-admin-base-url"

    init() {
        environment = .staging
        baseURLString = SiteAdminEnvironment.staging.baseURLString
        defaults.set(SiteAdminEnvironment.staging.rawValue, forKey: environmentKey)
        defaults.set(SiteAdminEnvironment.staging.baseURLString, forKey: baseURLKey)
        loadAuth(for: environment)
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

    var currentReleaseJobId: String? {
        summary?.release.runningJob?.id ?? summary?.release.latestJob?.id
    }

    var recentReleaseEvents: [ReleaseJobEvent] {
        Array((releaseDetail?.events ?? []).suffix(12)).reversed()
    }

    func selectEnvironment(_ next: SiteAdminEnvironment) {
        guard next != environment else { return }
        environment = next
        baseURLString = next.baseURLString
        defaults.set(next.rawValue, forKey: environmentKey)
        defaults.set(next.baseURLString, forKey: baseURLKey)
        summary = nil
        releaseDetail = nil
        loadAuth(for: next)
        message = isSignedIn
            ? "Switched to \(next.name). Using the saved \(next.technicalName) sign-in."
            : "Switched to \(next.name). Sign in once for \(next.technicalName)."
    }

    func saveCustomBaseURL() {
        baseURLString = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        defaults.set(environment.rawValue, forKey: environmentKey)
        defaults.set(baseURLString, forKey: baseURLKey)
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
            if let jobId = currentReleaseJobId {
                await refreshReleaseDetail(jobId: jobId, reportErrors: false)
            } else {
                releaseDetail = nil
            }
        } catch {
            clearCurrentTokenIfExpired(error)
            message = friendlyMessage(for: error)
        }
    }

    func signIn() async {
        guard let baseURL else {
            message = "Invalid Site Admin URL."
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            message = nil
            let result = try await authenticator.signIn(baseURL: baseURL)
            token = result.token
            login = result.login
            tokenExpiresAt = result.expiresAt
            try tokenStore(for: environment).save(result.token)
            saveAuthMetadata(login: result.login, expiresAt: result.expiresAt, for: environment)
            await refresh()
        } catch {
            message = friendlyMessage(for: error)
        }
    }

    func clearAuth() {
        tokenStore(for: environment).delete()
        clearAuthMetadata(for: environment)
        resetCurrentAuthState()
    }

    func clearAllAuth() {
        for environment in SiteAdminEnvironment.allCases {
            tokenStore(for: environment).delete()
            clearAuthMetadata(for: environment)
        }
        legacyTokenStore.delete()
        resetCurrentAuthState()
    }

    func isSignedIn(to environment: SiteAdminEnvironment) -> Bool {
        tokenStore(for: environment).load()?.isEmpty == false
    }

    func signInStatus(for environment: SiteAdminEnvironment) -> String {
        isSignedIn(to: environment) ? "Signed in" : "Not signed in"
    }

    private func resetCurrentAuthState() {
        token = nil
        login = ""
        tokenExpiresAt = ""
        summary = nil
        releaseDetail = nil
    }

    func updateNow(text: String, context: String, location: String) async -> Bool {
        guard environment.canEditContent else {
            message = "Content editing is available only in the Draft workspace."
            return false
        }
        guard let client else {
            message = "Invalid Site Admin URL."
            return false
        }
        isLoading = true
        defer { isLoading = false }
        do {
            message = nil
            try await client.updateNow(text: text, context: context, location: location)
            await refresh()
            return true
        } catch {
            clearCurrentTokenIfExpired(error)
            message = friendlyMessage(for: error)
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
            message = nil
            let job = try await client.smartRelease()
            releaseDetail = ReleaseJobDetailPayload(job: job, events: [])
            await refresh()
            await refreshReleaseDetail(jobId: job.id, reportErrors: false)
        } catch {
            clearCurrentTokenIfExpired(error)
            message = friendlyMessage(for: error)
        }
    }

    func runRecommendedReleaseAction() async {
        switch summary?.release.recommendedAction.kind {
        case "refresh":
            await refresh()
        case "watch-release":
            await refreshReleaseDetail(reportErrors: true)
        case "noop":
            return
        default:
            await smartRelease()
        }
    }

    func refreshReleaseDetail(jobId: String? = nil, reportErrors: Bool = true) async {
        guard let jobId = jobId ?? currentReleaseJobId, !jobId.isEmpty else {
            releaseDetail = nil
            return
        }
        guard let client else {
            if reportErrors {
                message = "Invalid Site Admin URL."
            }
            return
        }
        isReleaseDetailLoading = true
        defer { isReleaseDetailLoading = false }
        do {
            releaseDetail = try await client.releaseJob(id: jobId)
            if reportErrors {
                message = nil
            }
        } catch {
            clearCurrentTokenIfExpired(error)
            if reportErrors {
                message = friendlyMessage(for: error)
            }
        }
    }

    private func tokenStore(for environment: SiteAdminEnvironment) -> KeychainTokenStore {
        KeychainTokenStore(
            service: keychainService,
            account: "site-admin-token-\(environment.rawValue)"
        )
    }

    private func metadataKey(_ suffix: String, for environment: SiteAdminEnvironment) -> String {
        "site-admin-\(environment.rawValue)-\(suffix)"
    }

    private func loadAuth(for environment: SiteAdminEnvironment) {
        if let stored = tokenStore(for: environment).load() {
            token = stored
        } else if let legacyToken = legacyTokenStore.load(), environment == .staging {
            token = legacyToken
            try? tokenStore(for: environment).save(legacyToken)
            legacyTokenStore.delete()
        } else {
            token = nil
        }
        login = defaults.string(forKey: metadataKey("login", for: environment)) ?? ""
        tokenExpiresAt = defaults.string(forKey: metadataKey("expires-at", for: environment)) ?? ""
    }

    private func saveAuthMetadata(login: String, expiresAt: String, for environment: SiteAdminEnvironment) {
        defaults.set(login, forKey: metadataKey("login", for: environment))
        defaults.set(expiresAt, forKey: metadataKey("expires-at", for: environment))
    }

    private func clearAuthMetadata(for environment: SiteAdminEnvironment) {
        defaults.removeObject(forKey: metadataKey("login", for: environment))
        defaults.removeObject(forKey: metadataKey("expires-at", for: environment))
    }

    private func clearCurrentTokenIfExpired(_ error: Error) {
        guard isAuthExpired(error) else { return }
        tokenStore(for: environment).delete()
        clearAuthMetadata(for: environment)
        token = nil
        login = ""
        tokenExpiresAt = ""
        summary = nil
        releaseDetail = nil
    }

    private func isAuthExpired(_ error: Error) -> Bool {
        guard let clientError = error as? SiteAdminClientError else { return false }
        switch clientError {
        case .api(let message):
            let normalized = message.lowercased()
            return normalized.contains("expired") || normalized.contains("unauthorized")
        default:
            return false
        }
    }

    private func friendlyMessage(for error: Error) -> String {
        if let clientError = error as? SiteAdminClientError {
            return clientError.localizedDescription
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            return "Network request failed. Check your connection and try again."
        }
        return error.localizedDescription
    }
}
