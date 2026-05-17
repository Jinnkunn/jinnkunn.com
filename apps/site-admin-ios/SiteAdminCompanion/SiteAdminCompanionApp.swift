import SwiftUI

@main
struct SiteAdminCompanionApp: App {
    @State private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(session)
        }
    }
}
