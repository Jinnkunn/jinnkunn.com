import SwiftUI

struct CalendarView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if session.isSignedIn {
                        syncCard
                        livePreviewCard
                        sourceHealthCard
                    } else {
                        EmptySignedOutView()
                            .frame(minHeight: 420)
                    }
                }
                .padding()
            }
            .navigationTitle("Calendar")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            await session.refreshCalendarSyncHealth()
                            await session.refreshPublicCalendarPreview()
                        }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(
                        session.isCalendarSyncing ||
                        session.isCalendarHealthLoading ||
                        session.isPublicCalendarPreviewLoading
                    )
                }
            }
            .task {
                if session.isSignedIn {
                    await session.refreshCalendarSyncHealth(reportErrors: false)
                    await session.refreshPublicCalendarPreview(reportErrors: false)
                }
            }
        }
    }

    private var syncCard: some View {
        AdminCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(syncTitle, systemImage: syncIcon)
                            .font(.headline)
                            .foregroundStyle(syncColor)
                        Text(syncDetail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if session.isCalendarSyncing {
                        ProgressView()
                    }
                }

                HStack(spacing: 10) {
                    Button {
                        Task { await session.syncCalendarsFromDevice() }
                    } label: {
                        Label(
                            session.isCalendarSyncing ? "Syncing" : "Sync Now",
                            systemImage: "arrow.triangle.2.circlepath"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(session.isCalendarSyncing || session.isLoading)

                    Button {
                        Task { await session.refreshPublicCalendarPreview() }
                    } label: {
                        Label("Check Live", systemImage: "globe")
                    }
                    .buttonStyle(.bordered)
                    .disabled(session.isPublicCalendarPreviewLoading)
                }

                if let status = session.calendarSyncStatus {
                    Divider()
                    CalendarMetricGrid(items: [
                        ("Last attempt", session.compactDate(status.recordedAt)),
                        ("Draft accepted", session.compactDate(status.syncedAt)),
                        ("Live updated", session.compactDate(status.livePublishedAt)),
                        ("Observed", status.observationsWritten.map { String($0) } ?? "-"),
                        ("Sources", status.sourcesWritten.map { String($0) } ?? "-"),
                        ("Merged", status.entitiesWritten.map { String($0) } ?? "-"),
                    ])

                    if let liveMessage = status.liveMessage, !liveMessage.isEmpty {
                        Text(liveMessage)
                            .font(.caption)
                            .foregroundStyle(status.livePublishedAt == nil ? .orange : .secondary)
                    }
                }
            }
        }
    }

    private var livePreviewCard: some View {
        AdminCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Live Public Calendar", systemImage: "calendar")
                        .font(.headline)
                    Spacer()
                    if session.isPublicCalendarPreviewLoading {
                        ProgressView()
                            .controlSize(.small)
                    } else if let preview = session.publicCalendarPreview {
                        Text("\(preview.events.count)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }

                if let preview = session.publicCalendarPreview {
                    Text("Generated \(session.compactDate(preview.generatedAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    let events = Array(preview.events.prefix(5))
                    if events.isEmpty {
                        Text("No public calendar events are listed.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(events) { event in
                                PublicCalendarEventRow(event: event)
                            }
                        }
                    }
                } else {
                    Text("Refresh to verify what visitors currently see on Live.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var sourceHealthCard: some View {
        AdminCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Source Health", systemImage: "waveform.path.ecg")
                        .font(.headline)
                    Spacer()
                    if session.isCalendarHealthLoading {
                        ProgressView()
                            .controlSize(.small)
                    } else if let health = session.calendarSyncHealth {
                        Text("\(health.entityCount) merged")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }

                if let health = session.calendarSyncHealth {
                    if let latestSyncedAt = health.latestSyncedAt {
                        Text("Latest source sync \(session.compactDate(latestSyncedAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    VStack(spacing: 8) {
                        ForEach(Array(health.sources.prefix(6))) { source in
                            CalendarSyncSourceRow(source: source)
                        }
                    }

                    if health.sources.count > 6 {
                        Text("\(health.sources.count - 6) more sources")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Server source health appears after the first sync.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var syncTitle: String {
        if session.isCalendarSyncing { return "Syncing iPhone calendars" }
        guard let status = session.calendarSyncStatus else {
            return "Ready to sync"
        }
        return status.isSuccess ? "Last sync succeeded" : "Last sync failed"
    }

    private var syncDetail: String {
        if session.isCalendarSyncing {
            return "Reading EventKit, updating Draft, then publishing the safe Live projection."
        }
        return session.calendarSyncStatus?.message
            ?? "Sync the calendars visible on this iPhone. Live receives only the privacy-safe Busy projection."
    }

    private var syncIcon: String {
        if session.isCalendarSyncing { return "arrow.triangle.2.circlepath" }
        guard let status = session.calendarSyncStatus else { return "calendar.badge.clock" }
        return status.isSuccess ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
    }

    private var syncColor: Color {
        if session.isCalendarSyncing { return .accentColor }
        guard let status = session.calendarSyncStatus else { return .primary }
        return status.isSuccess ? .green : .orange
    }
}

private struct CalendarMetricGrid: View {
    let items: [(String, String)]

    var body: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), alignment: .leading),
                GridItem(.flexible(), alignment: .leading),
            ],
            spacing: 10
        ) {
            ForEach(items, id: \.0) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.0)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(item.1)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }
}

private struct PublicCalendarEventRow: View {
    let event: PublicCalendarEvent

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(Color.accentColor)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        if event.isAllDay { return "All day" }
        return "\(compactDate(event.startsAt)) - \(compactDate(event.endsAt))"
    }

    private func compactDate(_ iso: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        return date?.formatted(.dateTime.month(.abbreviated).day().hour().minute()) ?? iso
    }
}

private struct CalendarSyncSourceRow: View {
    let source: CalendarSyncHealthSource

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(source.title)
                    .lineLimit(1)
                Spacer()
                Text("\(source.eventCount)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Text("\(source.provider) · \(collectorLabel)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.vertical, 2)
    }

    private var collectorLabel: String {
        if source.collectorId.hasPrefix("ios:") { return "iPhone" }
        if source.collectorId.hasPrefix("tauri-macos:") { return "Mac" }
        return source.collectorId
    }
}
