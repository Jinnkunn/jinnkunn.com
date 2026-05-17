import SwiftUI

struct RootTabView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        TabView {
            TodayView()
                .tabItem {
                    Label("Today", systemImage: "circle.grid.2x2.fill")
                }

            ContentView()
                .tabItem {
                    Label("Content", systemImage: "doc.text")
                }

            ReleaseView()
                .tabItem {
                    Label("Release", systemImage: "arrow.up.circle")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
        .task {
            if session.isSignedIn, session.summary == nil {
                await session.refresh()
            }
        }
    }
}

struct AdminCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.primary.opacity(0.08), lineWidth: 1)
            }
    }
}

struct SiteAdminEnvironmentPicker: View {
    @Environment(AppSession.self) private var session
    var showURL = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker(
                "Site Admin environment",
                selection: Binding(
                    get: { session.environment },
                    set: { session.selectEnvironment($0) }
                )
            ) {
                ForEach(SiteAdminEnvironment.allCases) { environment in
                    Text(environment.name).tag(environment)
                }
            }
            .pickerStyle(.segmented)

            if showURL {
                Text(session.baseURLString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
    }
}

struct EmptySignedOutView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        ContentUnavailableView {
            Label("Connect Site Admin", systemImage: "lock.open")
        } description: {
            VStack(spacing: 12) {
                Text("Choose a Site Admin environment, then sign in once to manage the website from this device.")
                SiteAdminEnvironmentPicker()
                    .frame(maxWidth: 320)
            }
        } actions: {
            Button("Sign In to \(session.environment.name)") {
                Task { await session.signIn() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(session.isLoading)
        }
    }
}
