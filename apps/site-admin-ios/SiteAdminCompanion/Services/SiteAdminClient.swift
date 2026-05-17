import Foundation

enum SiteAdminClientError: LocalizedError {
    case invalidBaseURL
    case missingToken
    case invalidResponse
    case api(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "The Site Admin URL is invalid."
        case .missingToken:
            return "Sign in before making Site Admin requests."
        case .invalidResponse:
            return "The server returned an unexpected response."
        case .api(let message):
            return message
        }
    }
}

struct EmptyPayload: Decodable {}

struct SiteAdminClient {
    var baseURL: URL
    var token: String?

    func summary() async throws -> SiteAdminMobileSummary {
        let payload: SiteAdminMobileSummaryPayload = try await request(
            path: "/api/site-admin/mobile/summary"
        )
        return payload.summary
    }

    func updateNow(text: String, context: String, location: String) async throws {
        let body: [String: String] = [
            "text": text,
            "context": context,
            "location": location,
        ]
        let _: EmptyPayload = try await request(
            path: "/api/site-admin/now",
            method: "POST",
            body: body
        )
    }

    func smartRelease() async throws -> ReleaseJob {
        let body: [String: [String: String]] = [
            "request": ["source": "ios"]
        ]
        let payload: ReleaseJobPayload = try await request(
            path: "/api/site-admin/release-jobs/smart",
            method: "POST",
            body: body
        )
        return payload.job
    }

    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: Any? = nil
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw SiteAdminClientError.invalidBaseURL
        }
        guard let token, !token.isEmpty else {
            throw SiteAdminClientError.missingToken
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SiteAdminClientError.invalidResponse
        }

        let envelope = try JSONDecoder().decode(APIEnvelope<T>.self, from: data)
        if envelope.ok, let payload = envelope.data {
            return payload
        }

        let fallback = HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
        throw SiteAdminClientError.api(envelope.error ?? fallback)
    }
}
