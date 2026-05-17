import SwiftUI

struct TodayView: View {
    @Environment(AppSession.self) private var session
    @State private var showNowSheet = false

    var body: some View {
        NavigationStack {
            Group {
                if !session.isSignedIn {
                    EmptySignedOutView()
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            header
                            message
                            nowCard
                            releaseCard
                            statusGrid
                        }
                        .padding()
                    }
                    .refreshable {
                        await session.refresh()
                    }
                }
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await session.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(session.isLoading || !session.isSignedIn)
                }
            }
            .sheet(isPresented: $showNowSheet) {
                NowQuickUpdateSheet()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(session.summary?.site.name ?? "jinkunchen.com")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text(session.summary?.release.headline ?? "Loading site status")
                .font(.title.bold())
                .contentTransition(.numericText())
        }
    }

    @ViewBuilder
    private var message: some View {
        if let message = session.message, !message.isEmpty {
            Text(message)
                .font(.callout)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var nowCard: some View {
        AdminCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Now", systemImage: "sparkle")
                    .font(.headline)
                Text(session.summary?.now.text.isEmpty == false ? session.summary!.now.text : "No current status.")
                    .font(.title3.weight(.semibold))
                if let context = session.summary?.now.context, !context.isEmpty {
                    Text(context)
                        .foregroundStyle(.secondary)
                }
                Button {
                    showNowSheet = true
                } label: {
                    Label("Update Now", systemImage: "square.and.pencil")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!session.environment.canEditContent)

                if !session.environment.canEditContent {
                    Text("Live is read-only. Switch to Draft to update this status.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var releaseCard: some View {
        AdminCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Release", systemImage: "arrow.up.circle")
                    .font(.headline)
                Text(session.summary?.release.detail ?? "Refresh to load release status.")
                    .foregroundStyle(.secondary)

                Button {
                    Task { await session.smartRelease() }
                } label: {
                    Label(
                        session.summary?.release.recommendedAction.label ?? "Smart Release",
                        systemImage: "bolt.circle"
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(session.isLoading || session.summary?.release.recommendedAction.kind == "noop")
            }
        }
    }

    private var statusGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            metric("Posts", value: "\(session.summary?.content.posts ?? 0)", icon: "newspaper")
            metric("Pages", value: "\(session.summary?.content.pages ?? 0)", icon: "doc.on.doc")
            metric("Events", value: "\(session.summary?.calendar.eventCount ?? 0)", icon: "calendar")
            metric("Runtime", value: session.summary?.site.runtime.capitalized ?? "-", icon: "cloud")
        }
    }

    private func metric(_ title: String, value: String, icon: String) -> some View {
        AdminCard {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: icon)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.title2.bold())
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
