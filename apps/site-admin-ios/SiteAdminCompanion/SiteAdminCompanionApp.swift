import SwiftUI

@main
struct SiteAdminCompanionApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(session)
                .task {
                    await session.syncCalendarsIfNeeded(reason: "launch")
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task {
                        await session.syncCalendarsIfNeeded(reason: "foreground")
                    }
                }
        }
    }
}
