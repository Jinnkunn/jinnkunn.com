import Foundation

struct APIEnvelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: String?
    let code: String?
}

struct SiteAdminMobileSummaryPayload: Decodable {
    let summary: SiteAdminMobileSummary
}

struct SiteAdminMobileSummary: Decodable {
    let generatedAt: String
    let site: SiteInfo
    let now: NowInfo
    let calendar: CalendarInfo
    let content: ContentInfo
    let release: ReleaseInfo
    let source: SourceInfo

    struct SiteInfo: Decodable {
        let name: String
        let environment: String
        let runtime: String
    }

    struct NowInfo: Decodable {
        let text: String
        let context: String
        let location: String
        let updatedAt: String
        let historyCount: Int
    }

    struct CalendarInfo: Decodable {
        let generatedAt: String
        let eventCount: Int
        let rangeStartsAt: String
        let rangeEndsAt: String
    }

    struct ContentInfo: Decodable {
        let posts: Int
        let pages: Int
    }

    struct ReleaseInfo: Decodable {
        let headline: String
        let detail: String
        let recommendedAction: RecommendedAction
        let runningJob: ReleaseJob?
        let latestJob: ReleaseJob?
        let runners: [ReleaseRunner]
    }

    struct RecommendedAction: Decodable {
        let kind: String
        let label: String
        let destructive: Bool
    }

    struct SourceInfo: Decodable {
        let storeKind: String
        let branch: String
        let codeSha: String
        let contentSha: String
        let pendingDeploy: Bool?
        let deployableVersionReady: Bool?
    }
}

struct ReleaseJob: Decodable, Identifiable {
    let id: String
    let action: String
    let script: String
    let target: String
    let status: String
    let phase: String
    let createdAt: Int64
    let updatedAt: Int64
    let finishedAt: Int64?
    let error: String
}

struct ReleaseRunner: Decodable, Identifiable {
    var id: String { agentId }

    let agentId: String
    let status: String
    let currentJobId: String
    let lastSeenAt: Int64
}

struct NowPostPayload: Decodable {
    let data: SiteAdminMobileSummary.NowInfo?
}

struct ReleaseJobPayload: Decodable {
    let job: ReleaseJob
}

struct ReleaseJobDetailPayload: Decodable {
    let job: ReleaseJob
    let events: [ReleaseJobEvent]
}

struct ReleaseJobEvent: Decodable, Identifiable {
    let id: String
    let jobId: String
    let seq: Int
    let at: Int64
    let phase: String
    let stream: String
    let message: String
}

struct AuthResult: Equatable {
    let token: String
    let login: String
    let expiresAt: String
}
