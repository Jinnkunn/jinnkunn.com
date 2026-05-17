import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        NavigationStack {
            Form {
                Section("Workspace") {
                    LabeledContent("Editing source", value: "Draft")
                    LabeledContent("Published site", value: "Live")
                    Text("Use this app to edit Draft. Release publishes the verified Draft state to Live.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Account") {
                    if session.isSignedIn {
                        LabeledContent("Status", value: "Signed in")
                        if !session.login.isEmpty {
                            LabeledContent("Login", value: session.login)
                        }
                        if !session.tokenExpiresAt.isEmpty {
                            LabeledContent("Token") {
                                Text(session.tokenExpiresAt)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Button("Refresh") {
                            Task { await session.refresh() }
                        }
                        Button("Sign Out", role: .destructive) {
                            session.clearAuth()
                        }
                    } else {
                        Button("Sign In") {
                            Task { await session.signIn() }
                        }
                    }
                }

                CalendarSyncSection()

                Section("Advanced Diagnostics") {
                    LabeledContent("Draft API") {
                        Text(SiteAdminEnvironment.staging.baseURLString)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    LabeledContent("Live API") {
                        Text(SiteAdminEnvironment.production.baseURLString)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Text("Direct Live editing is intentionally hidden. The Release tab is the path from Draft to Live.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Button("Reset Saved Sessions", role: .destructive) {
                        session.clearAllAuth()
                    }
                }

                Section("Runtime") {
                    LabeledContent("Environment", value: session.summary?.site.environment.isEmpty == false ? session.summary!.site.environment : "-")
                    LabeledContent("Runtime", value: session.summary?.site.runtime.capitalized ?? "-")
                    LabeledContent("Source", value: session.summary?.source.storeKind.isEmpty == false ? session.summary!.source.storeKind : "-")
                }

                if let message = session.message, !message.isEmpty {
                    Section("Message") {
                        Text(message)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

private struct CalendarSyncSection: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        Section("Calendar Sync") {
            statusCard

            Button {
                Task { await session.syncCalendarsFromDevice() }
            } label: {
                if session.isCalendarSyncing {
                    Label("Syncing Calendars", systemImage: "arrow.triangle.2.circlepath")
                } else {
                    Label("Sync iPhone Calendars", systemImage: "calendar.badge.clock")
                }
            }
            .disabled(!session.isSignedIn || session.isCalendarSyncing || session.isLoading)

            Button {
                Task { await session.refreshCalendarSyncHealth() }
            } label: {
                Label("Refresh Sync Status", systemImage: "arrow.clockwise")
            }
            .disabled(!session.isSignedIn || session.isCalendarSyncing || session.isCalendarHealthLoading)

            if let status = session.calendarSyncStatus {
                LabeledContent("Last attempt", value: compactDate(status.recordedAt))
                if let syncedAt = status.syncedAt {
                    LabeledContent("Server accepted", value: compactDate(syncedAt))
                }
                if let observationsWritten = status.observationsWritten {
                    LabeledContent("Observed events", value: "\(observationsWritten)")
                }
                if let sourcesWritten = status.sourcesWritten {
                    LabeledContent("Sources", value: "\(sourcesWritten)")
                }
                if let entitiesWritten = status.entitiesWritten {
                    LabeledContent("Merged events", value: "\(entitiesWritten)")
                }
                if let staleObservations = status.staleObservations, staleObservations > 0 {
                    LabeledContent("Stale in source", value: "\(staleObservations)")
                }
            }

            if let health = session.calendarSyncHealth {
                LabeledContent("Server merged events", value: "\(health.entityCount)")
                if let latestSyncedAt = health.latestSyncedAt {
                    LabeledContent("Latest source sync", value: compactDate(latestSyncedAt))
                }
                ForEach(Array(health.sources.prefix(4))) { source in
                    CalendarSyncSourceRow(source: source)
                }
                if health.sources.count > 4 {
                    Text("\(health.sources.count - 4) more sources")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Server sync status appears after sign-in or the first refresh.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Label(statusTitle, systemImage: statusIcon)
                    .font(.headline)
                    .foregroundStyle(statusColor)
                if session.isCalendarSyncing || session.isCalendarHealthLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            Text(statusDetail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var statusTitle: String {
        if session.isCalendarSyncing { return "Syncing iPhone calendars" }
        guard let status = session.calendarSyncStatus else {
            return "Not synced from this iPhone"
        }
        return status.isSuccess ? "Last sync succeeded" : "Last sync failed"
    }

    private var statusDetail: String {
        if session.isCalendarSyncing {
            return "Reading EventKit and uploading a source-aware snapshot to Draft."
        }
        return session.calendarSyncStatus?.message
            ?? "Upload the calendars visible on this iPhone. The server merges them with other collectors instead of treating this phone as the only source of truth."
    }

    private var statusIcon: String {
        if session.isCalendarSyncing { return "arrow.triangle.2.circlepath" }
        guard let status = session.calendarSyncStatus else { return "calendar" }
        return status.isSuccess ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
    }

    private var statusColor: Color {
        if session.isCalendarSyncing { return .accentColor }
        guard let status = session.calendarSyncStatus else { return .primary }
        return status.isSuccess ? .green : .orange
    }

    private func compactDate(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "-" }
        guard let date = parseIsoDate(iso) else { return iso }
        return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    private func parseIsoDate(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) {
            return date
        }
        return ISO8601DateFormatter().date(from: iso)
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
    }

    private var collectorLabel: String {
        if source.collectorId.hasPrefix("ios:") { return "iPhone" }
        if source.collectorId.hasPrefix("tauri-macos:") { return "Mac" }
        return source.collectorId
    }
}
