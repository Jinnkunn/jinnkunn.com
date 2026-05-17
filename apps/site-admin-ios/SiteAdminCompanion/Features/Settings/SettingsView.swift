import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        @Bindable var bindableSession = session
        NavigationStack {
            Form {
                Section("Environment") {
                    SiteAdminEnvironmentPicker()
                    ForEach(SiteAdminEnvironment.allCases) { environment in
                        LabeledContent(environment.name, value: session.signInStatus(for: environment))
                    }
                }

                Section("Account") {
                    if session.isSignedIn {
                        LabeledContent("Status", value: "Signed in")
                        LabeledContent("Mode", value: "\(session.environment.name) / \(session.environment.technicalName)")
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
                        Button("Sign Out from \(session.environment.name)", role: .destructive) {
                            session.clearAuth()
                        }
                    } else {
                        Button("Sign In to \(session.environment.name)") {
                            Task { await session.signIn() }
                        }
                    }
                    Button("Sign Out Everywhere", role: .destructive) {
                        session.clearAllAuth()
                    }
                }

                Section("Advanced") {
                    TextField("Custom Site Admin URL", text: $bindableSession.baseURLString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()

                    Button("Save URL and Sign Out from Current Mode") {
                        session.saveCustomBaseURL()
                        session.clearAuth()
                        session.message = "Custom URL saved. Sign in again."
                    }
                    .disabled(session.baseURL == nil)
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
