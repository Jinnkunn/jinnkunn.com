import SwiftUI

struct ContentView: View {
    @Environment(AppSession.self) private var session
    @State private var showNowSheet = false

    var body: some View {
        NavigationStack {
            Group {
                if !session.isSignedIn {
                    EmptySignedOutView()
                } else {
                    List {
                        Section("Quick Edit") {
                            Button {
                                showNowSheet = true
                            } label: {
                                Label("Now Status", systemImage: "sparkle")
                            }
                        }

                        Section("Library") {
                            contentRow("News and blog posts", count: session.summary?.content.posts ?? 0, icon: "newspaper")
                            contentRow("Pages", count: session.summary?.content.pages ?? 0, icon: "doc.on.doc")
                            contentRow("Public calendar items", count: session.summary?.calendar.eventCount ?? 0, icon: "calendar")
                        }
                    }
                    .refreshable {
                        await session.refresh()
                    }
                }
            }
            .navigationTitle("Content")
            .sheet(isPresented: $showNowSheet) {
                NowQuickUpdateSheet()
            }
        }
    }

    private func contentRow(_ title: String, count: Int, icon: String) -> some View {
        Label {
            HStack {
                Text(title)
                Spacer()
                Text("\(count)")
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: icon)
        }
    }
}
