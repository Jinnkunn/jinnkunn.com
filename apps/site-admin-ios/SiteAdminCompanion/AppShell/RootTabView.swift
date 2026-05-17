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

struct EmptySignedOutView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        ContentUnavailableView {
            Label("Connect Site Admin", systemImage: "lock.open")
        } description: {
            Text("Sign in once to manage the website from this device.")
        } actions: {
            Button("Sign In") {
                Task { await session.signIn() }
            }
            .buttonStyle(.borderedProminent)
        }
    }
}
