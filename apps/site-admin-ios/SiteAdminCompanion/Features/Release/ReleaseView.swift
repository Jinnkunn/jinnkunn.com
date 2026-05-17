import SwiftUI

struct ReleaseView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        NavigationStack {
            Group {
                if !session.isSignedIn {
                    EmptySignedOutView()
                } else {
                    List {
                        Section {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(session.summary?.release.headline ?? "Release status")
                                    .font(.headline)
                                Text(session.summary?.release.detail ?? "Refresh to load release status.")
                                    .font(.callout)
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
                            .padding(.vertical, 6)
                        }

                        if let job = session.summary?.release.runningJob {
                            Section("Running") {
                                jobRow(job)
                            }
                        }

                        if let job = session.summary?.release.latestJob {
                            Section("Latest Job") {
                                jobRow(job)
                            }
                        }

                        Section("Runner") {
                            if session.summary?.release.runners.isEmpty != false {
                                Text("No runner heartbeat yet.")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(session.summary?.release.runners ?? []) { runner in
                                    HStack {
                                        Label(runner.agentId, systemImage: "desktopcomputer")
                                        Spacer()
                                        Text(runner.status.capitalized)
                                            .foregroundStyle(runner.status == "running" ? .orange : .secondary)
                                    }
                                }
                            }
                        }
                    }
                    .refreshable {
                        await session.refresh()
                    }
                }
            }
            .navigationTitle("Release")
        }
    }

    private func jobRow(_ job: ReleaseJob) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(job.script)
                    .font(.headline)
                Spacer()
                Text(job.status.capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(job.status == "failed" ? .red : .secondary)
            }
            if !job.phase.isEmpty {
                Text(job.phase)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !job.error.isEmpty {
                Text(job.error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }
}
