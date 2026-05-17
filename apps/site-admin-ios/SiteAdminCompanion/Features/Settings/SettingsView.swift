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

                Section("Calendar Sync") {
                    Text("Upload the calendars visible on this iPhone to Draft. The server merges them with other collectors by source instead of treating this phone as the only source of truth.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

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

                    if let result = session.calendarSyncResult {
                        LabeledContent("Last sync", value: result.syncedAt)
                        LabeledContent("Sources", value: "\(result.sourcesWritten)")
                        LabeledContent("Observed events", value: "\(result.observationsWritten)")
                        LabeledContent("Merged events", value: "\(result.entitiesWritten)")
                        if result.staleObservations > 0 {
                            LabeledContent("Stale in source", value: "\(result.staleObservations)")
                        }
                    }
                }

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
