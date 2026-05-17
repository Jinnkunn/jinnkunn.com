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
            if session.isSignedIn {
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

struct DraftWorkspaceStatus: View {
    @Environment(AppSession.self) private var session
    var showURL = true

    var body: some View {
        VStack(spacing: 8) {
            Label("Draft Workspace", systemImage: "square.and.pencil")
                .font(.headline)

            Text("Edit and preview here. Publish from Release when Draft is ready for Live.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)

            if showURL {
                Text(session.baseURLString)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
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
                Text("Sign in once to manage the Draft workspace. Live is updated from the Release tab.")
                DraftWorkspaceStatus()
                    .frame(maxWidth: 320)
            }
        } actions: {
            Button("Sign In") {
                Task { await session.signIn() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(session.isLoading)
        }
    }
}
