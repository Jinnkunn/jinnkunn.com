import EventKit
import Foundation
import UIKit

enum CalendarObservationSyncError: LocalizedError {
    case accessDenied

    var errorDescription: String? {
        switch self {
        case .accessDenied:
            return "Calendar access is not available. Enable full calendar access in Settings, then try again."
        }
    }
}

final class CalendarObservationSyncService {
    private let store = EKEventStore()
    private let defaults = UserDefaults.standard
    private let collectorIdKey = "calendar-observation-collector-id"
    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    func makeSnapshotPayload() async throws -> CalendarObservationSyncPayload {
        try await ensureCalendarAccess()

        let collectorId = loadCollectorId()
        let deviceName = await MainActor.run { UIDevice.current.name }
        let calendar = Calendar.current
        let startsAt = calendar.startOfDay(for: Date())
        let endsAt = calendar.date(byAdding: .year, value: 1, to: startsAt) ?? startsAt

        let eventCalendars = store.calendars(for: .event)
        let predicate = store.predicateForEvents(
            withStart: startsAt,
            end: endsAt,
            calendars: eventCalendars
        )
        let events = store.events(matching: predicate)
            .filter { $0.endDate > startsAt && $0.startDate < endsAt }
            .sorted {
                if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
                return ($0.title ?? "") < ($1.title ?? "")
            }

        let sources = buildSourcePayloads(
            from: store.sources,
            calendars: eventCalendars
        )
        let sourceIds = Set(sources.map(\.id))
        let observations = events.map { event in
            observationPayload(
                for: event,
                collectorId: collectorId,
                fallbackSourceIds: sourceIds
            )
        }

        return CalendarObservationSyncPayload(
            collector: CalendarCollectorPayload(
                id: collectorId,
                kind: "ios",
                title: deviceName
            ),
            sources: sources,
            range: CalendarRangePayload(
                startsAt: iso(startsAt),
                endsAt: iso(endsAt)
            ),
            syncMode: "snapshot",
            observedAt: iso(Date()),
            observations: observations
        )
    }

    private func ensureCalendarAccess() async throws {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .authorized:
            return
        case .notDetermined:
            let granted = try await requestFullCalendarAccess()
            if granted { return }
            throw CalendarObservationSyncError.accessDenied
        case .restricted, .denied, .writeOnly:
            throw CalendarObservationSyncError.accessDenied
        @unknown default:
            throw CalendarObservationSyncError.accessDenied
        }
    }

    private func requestFullCalendarAccess() async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            store.requestFullAccessToEvents { granted, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: granted)
                }
            }
        }
    }

    private func loadCollectorId() -> String {
        if let existing = defaults.string(forKey: collectorIdKey), !existing.isEmpty {
            return existing
        }
        let collectorId = "ios:\(UUID().uuidString.lowercased())"
        defaults.set(collectorId, forKey: collectorIdKey)
        return collectorId
    }

    private func buildSourcePayloads(
        from sources: [EKSource],
        calendars: [EKCalendar]
    ) -> [CalendarSourcePayload] {
        var seen = Set<String>()
        var payloads: [CalendarSourcePayload] = []

        for source in sources.sorted(by: { $0.title < $1.title }) {
            let id = sourcePayloadId(source.sourceIdentifier)
            seen.insert(id)
            payloads.append(sourcePayload(for: source))
        }

        for eventCalendar in calendars {
            let id = sourcePayloadId(eventCalendar.source.sourceIdentifier)
            guard !seen.contains(id) else { continue }
            seen.insert(id)
            payloads.append(sourcePayload(for: eventCalendar.source))
        }

        return payloads.sorted { $0.title < $1.title }
    }

    private func sourcePayload(for source: EKSource) -> CalendarSourcePayload {
        CalendarSourcePayload(
            id: sourcePayloadId(source.sourceIdentifier),
            provider: providerName(for: source.sourceType),
            title: source.title,
            accountKey: source.title,
            externalSourceId: source.sourceIdentifier,
            syncScope: [
                "adapter": "eventkit",
                "platform": "ios",
            ]
        )
    }

    private func observationPayload(
        for event: EKEvent,
        collectorId: String,
        fallbackSourceIds: Set<String>
    ) -> CalendarObservationPayload {
        let sourceId = sourcePayloadId(event.calendar.source.sourceIdentifier)
        let effectiveSourceId = fallbackSourceIds.contains(sourceId)
            ? sourceId
            : sourcePayloadId("unknown")

        return CalendarObservationPayload(
            sourceId: effectiveSourceId,
            collectorId: collectorId,
            sourceEventId: event.eventIdentifier,
            iCalUid: event.calendarItemExternalIdentifier,
            recurrenceInstanceId: event.hasRecurrenceRules ? iso(event.startDate) : nil,
            calendarId: event.calendar.calendarIdentifier,
            calendarTitle: event.calendar.title,
            title: event.title,
            notes: event.notes,
            location: event.location,
            url: event.url?.absoluteString,
            startsAt: iso(event.startDate),
            endsAt: iso(event.endDate),
            isAllDay: event.isAllDay,
            isRecurring: event.hasRecurrenceRules,
            timezone: event.timeZone?.identifier,
            updatedAt: event.lastModifiedDate.map(iso)
        )
    }

    private func providerName(for sourceType: EKSourceType) -> String {
        switch sourceType {
        case .local, .birthdays:
            return "local"
        case .exchange:
            return "outlook"
        case .calDAV:
            return "caldav"
        case .mobileMe:
            return "apple"
        case .subscribed:
            return "ics"
        @unknown default:
            return "unknown"
        }
    }

    private func sourcePayloadId(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return "eventkit:\(trimmed.isEmpty ? "unknown" : trimmed)"
    }

    private func iso(_ date: Date) -> String {
        isoFormatter.string(from: date)
    }
}
