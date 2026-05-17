import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        @Bindable var session = session
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Site Admin URL", text: $session.baseURLString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()

                    if session.isSignedIn {
                        LabeledContent("Status", value: "Signed in")
                        if !session.login.isEmpty {
                            LabeledContent("Login", value: session.login)
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
