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

                Section("Calendar") {
                    Label("Calendar sync lives in the Calendar tab.", systemImage: "calendar")
                        .foregroundStyle(.secondary)
                    if let status = session.calendarSyncStatus {
                        LabeledContent("Last attempt", value: session.compactDate(status.recordedAt))
                    }
                    if let livePublishedAt = session.calendarSyncStatus?.livePublishedAt {
                        LabeledContent("Live updated", value: session.compactDate(livePublishedAt))
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
