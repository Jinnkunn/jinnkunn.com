import Foundation

struct CalendarObservationSyncPayload: Encodable {
    let schemaVersion = 1
    let collector: CalendarCollectorPayload
    let sources: [CalendarSourcePayload]
    let range: CalendarRangePayload
    let syncMode: String
    let observedAt: String
    let observations: [CalendarObservationPayload]
}

struct CalendarCollectorPayload: Encodable {
    let id: String
    let kind: String
    let title: String
}

struct CalendarSourcePayload: Encodable {
    let id: String
    let provider: String
    let title: String
    let accountKey: String?
    let externalSourceId: String?
    let syncScope: [String: String]
}

struct CalendarRangePayload: Encodable {
    let startsAt: String
    let endsAt: String
}

struct CalendarObservationPayload: Encodable {
    let sourceId: String
    let collectorId: String
    let sourceEventId: String?
    let iCalUid: String?
    let recurrenceInstanceId: String?
    let calendarId: String?
    let calendarTitle: String?
    let title: String?
    let notes: String?
    let location: String?
    let url: String?
    let startsAt: String
    let endsAt: String
    let isAllDay: Bool
    let isRecurring: Bool
    let timezone: String?
    let updatedAt: String?
}

struct CalendarObservationSyncResult: Decodable {
    let sourcesWritten: Int
    let observationsWritten: Int
    let entitiesWritten: Int
    let staleObservations: Int
    let syncedAt: String
}

struct CalendarSyncHealthPayload: Decodable {
    let health: CalendarSyncHealth
}

struct CalendarSyncHealth: Decodable {
    let sources: [CalendarSyncHealthSource]
    let entityCount: Int

    var latestSyncedAt: String? {
        sources.compactMap(\.lastSyncedAt).max()
    }
}

struct CalendarSyncHealthSource: Decodable, Identifiable {
    let id: String
    let provider: String
    let title: String
    let collectorId: String
    let lastSyncedAt: String?
    let eventCount: Int
}

struct CalendarDeviceSyncStatus: Codable {
    let state: String
    let message: String
    let recordedAt: String
    let syncedAt: String?
    let sourcesWritten: Int?
    let observationsWritten: Int?
    let entitiesWritten: Int?
    let staleObservations: Int?

    var isSuccess: Bool {
        state == "succeeded"
    }
}
