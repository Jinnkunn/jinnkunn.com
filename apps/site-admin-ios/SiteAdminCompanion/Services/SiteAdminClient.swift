import Foundation

enum SiteAdminClientError: LocalizedError {
    case invalidBaseURL
    case missingToken
    case invalidResponse
    case signInCanceled
    case signInCallbackFailed
    case api(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "The Site Admin URL is invalid."
        case .missingToken:
            return "Sign in before making Site Admin requests."
        case .invalidResponse:
            return "The server returned an unexpected response."
        case .signInCanceled:
            return "Sign-in was canceled."
        case .signInCallbackFailed:
            return "Sign-in finished, but the app did not receive a valid token. Check the deployed callback configuration."
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

    func nowDetail() async throws -> SiteAdminNowPayload {
        try await request(path: "/api/site-admin/now")
    }

    func updateNow(
        text: String,
        context: String,
        location: String,
        date: Date,
        expectedFileSha: String?
    ) async throws -> SiteAdminNowPayload {
        var body: [String: String] = [
            "action": "create",
            "text": text,
            "context": context,
            "location": location,
            "date": Self.nowDateString(date),
        ]
        if let expectedFileSha, !expectedFileSha.isEmpty {
            body["expectedFileSha"] = expectedFileSha
        }
        return try await request(
            path: "/api/site-admin/now",
            method: "POST",
            body: body
        )
    }

    func updateNowHistory(
        id: String,
        text: String,
        date: Date,
        expectedFileSha: String?
    ) async throws -> SiteAdminNowPayload {
        var body: [String: String] = [
            "action": "update-history",
            "id": id,
            "text": text,
            "date": Self.nowDateString(date),
        ]
        if let expectedFileSha, !expectedFileSha.isEmpty {
            body["expectedFileSha"] = expectedFileSha
        }
        return try await request(
            path: "/api/site-admin/now",
            method: "POST",
            body: body
        )
    }

    func deleteNowHistory(
        id: String,
        expectedFileSha: String?
    ) async throws -> SiteAdminNowPayload {
        var body: [String: String] = [
            "action": "delete-history",
            "id": id,
        ]
        if let expectedFileSha, !expectedFileSha.isEmpty {
            body["expectedFileSha"] = expectedFileSha
        }
        return try await request(
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

    func releaseJob(id: String) async throws -> ReleaseJobDetailPayload {
        try await request(
            path: "/api/site-admin/release-jobs/\(id)"
        )
    }

    func syncCalendarObservations(
        payload: CalendarObservationSyncPayload
    ) async throws -> CalendarObservationSyncResult {
        try await requestEncodable(
            path: "/api/site-admin/calendar-observations",
            method: "POST",
            body: payload
        )
    }

    func calendarSyncHealth() async throws -> CalendarSyncHealth {
        let payload: CalendarSyncHealthPayload = try await request(
            path: "/api/site-admin/calendar-observations"
        )
        return payload.health
    }

    func publishCalendarObservationsToLive() async throws -> CalendarObservationLivePublishPayload {
        try await request(
            path: "/api/site-admin/calendar-observations/publish-live",
            method: "POST",
            body: ["source": "ios"]
        )
    }

    static func publicCalendarPreview() async throws -> PublicCalendarPayload {
        guard let url = URL(string: "\(SiteAdminEnvironment.production.baseURLString)/api/public/calendar") else {
            throw SiteAdminClientError.invalidBaseURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SiteAdminClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SiteAdminClientError.api(
                "Live calendar preview failed (HTTP \(http.statusCode))."
            )
        }
        return try JSONDecoder().decode(PublicCalendarPayload.self, from: data)
    }

    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: Any? = nil,
        bodyData: Data? = nil
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

        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        } else if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SiteAdminClientError.invalidResponse
        }

        let envelope: APIEnvelope<T>
        do {
            envelope = try JSONDecoder().decode(APIEnvelope<T>.self, from: data)
        } catch {
            if http.statusCode == 401 {
                throw SiteAdminClientError.api("Your app session has expired. Sign in again.")
            }
            throw SiteAdminClientError.api(
                "The server returned an unexpected response (HTTP \(http.statusCode))."
            )
        }
        if envelope.ok, let payload = envelope.data {
            return payload
        }

        let fallback = HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
        throw SiteAdminClientError.api(envelope.error ?? fallback)
    }

    private func requestEncodable<T: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body
    ) async throws -> T {
        let encoder = JSONEncoder()
        let data = try encoder.encode(body)
        return try await request(
            path: path,
            method: method,
            bodyData: data
        )
    }

    private static func nowDateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/Halifax")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
