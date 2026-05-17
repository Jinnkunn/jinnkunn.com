import Foundation
import Observation

enum SiteAdminEnvironment: String, CaseIterable, Identifiable {
    case staging
    case production

    var id: String { rawValue }

    var name: String {
        switch self {
        case .staging:
            return "Staging"
        case .production:
            return "Production"
        }
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
    @ObservationIgnored private let tokenStore = KeychainTokenStore(
        service: "com.jinkunchen.SiteAdminCompanion",
        account: "site-admin-token"
    )
    @ObservationIgnored private let authenticator = SiteAdminAuthenticator()
    @ObservationIgnored private let environmentKey = "site-admin-environment"
    @ObservationIgnored private let baseURLKey = "site-admin-base-url"

    init() {
        if let raw = defaults.string(forKey: environmentKey),
           let savedEnvironment = SiteAdminEnvironment(rawValue: raw) {
            environment = savedEnvironment
            baseURLString = savedEnvironment.baseURLString
        } else if let savedBaseURL = defaults.string(forKey: baseURLKey), !savedBaseURL.isEmpty {
            baseURLString = savedBaseURL
            environment = savedBaseURL.contains("staging.") ? .staging : .production
        }
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
        clearAuth()
        message = "Switched to \(next.name). Sign in again for this environment."
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
            try tokenStore.save(result.token)
            await refresh()
        } catch {
            message = friendlyMessage(for: error)
        }
    }

    func clearAuth() {
        token = nil
        login = ""
        tokenExpiresAt = ""
        summary = nil
        releaseDetail = nil
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
            message = nil
            try await client.updateNow(text: text, context: context, location: location)
            await refresh()
            return true
        } catch {
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
            message = friendlyMessage(for: error)
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
            if reportErrors {
                message = friendlyMessage(for: error)
            }
        }
    }

    private func friendlyMessage(for error: Error) -> String {
        if let clientError = error as? SiteAdminClientError {
            return clientError.localizedDescription
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            return "Network request failed. Check your connection and the selected Site Admin environment."
        }
        return error.localizedDescription
    }
}
