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
                            releaseSummary
                        }

                        Section("Mode") {
                            LabeledContent(session.environment.name, value: session.environment.technicalName)
                            Text(
                                session.environment == .staging
                                    ? "Draft release publishes the staging preview first."
                                    : "Live release promotes the validated staging build to production."
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }

                        if let job = session.summary?.release.runningJob {
                            Section("Current Job") {
                                jobRow(job)
                            }
                        }

                        if let job = session.summary?.release.latestJob,
                           job.id != session.summary?.release.runningJob?.id {
                            Section("Latest Job") {
                                jobRow(job)
                            }
                        }

                        Section("Recent Log") {
                            if session.isReleaseDetailLoading {
                                HStack {
                                    ProgressView()
                                    Text("Loading release log")
                                        .foregroundStyle(.secondary)
                                }
                            } else if session.recentReleaseEvents.isEmpty {
                                Text("No release log for this job yet.")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(session.recentReleaseEvents) { event in
                                    eventRow(event)
                                }
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

                        if let message = session.message, !message.isEmpty {
                            Section("Message") {
                                Text(message)
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                    .refreshable {
                        await session.refresh()
                    }
                }
            }
            .navigationTitle("Release")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await session.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(session.isLoading)
                }
            }
            .task(id: session.currentReleaseJobId) {
                await session.refreshReleaseDetail(reportErrors: false)
            }
        }
    }

    private var releaseSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label {
                Text(session.summary?.release.headline ?? "Release status")
                    .font(.headline)
            } icon: {
                Image(systemName: releaseIcon)
                    .foregroundStyle(releaseColor)
            }

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

    private var releaseIcon: String {
        switch session.summary?.release.recommendedAction.kind {
        case "noop":
            return "checkmark.circle.fill"
        case "watch-release":
            return "dot.radiowaves.left.and.right"
        case "refresh":
            return "arrow.clockwise.circle"
        default:
            return "bolt.circle.fill"
        }
    }

    private var releaseColor: Color {
        switch session.summary?.release.recommendedAction.kind {
        case "noop":
            return .green
        case "watch-release":
            return .orange
        case "refresh":
            return .secondary
        default:
            return .accentColor
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
                    .foregroundStyle(jobStatusColor(job.status))
            }
            if !job.phase.isEmpty {
                Text(job.phase)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text("\(job.target.capitalized) · \(relativeTime(job.updatedAt))")
                .font(.caption2)
                .foregroundStyle(.tertiary)
            if !job.error.isEmpty {
                Text(job.error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private func eventRow(_ event: ReleaseJobEvent) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(event.phase.isEmpty ? event.stream.uppercased() : event.phase.uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(event.stream == "stderr" ? .red : .secondary)
                Spacer()
                Text(relativeTime(event.at))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Text(event.message)
                .font(.caption.monospaced())
                .foregroundStyle(event.stream == "stderr" ? .red : .primary)
                .lineLimit(4)
        }
        .padding(.vertical, 3)
    }

    private func jobStatusColor(_ status: String) -> Color {
        switch status {
        case "succeeded":
            return .green
        case "failed", "canceled":
            return .red
        case "queued", "running":
            return .orange
        default:
            return .secondary
        }
    }

    private func relativeTime(_ milliseconds: Int64) -> String {
        guard milliseconds > 0 else { return "-" }
        let date = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
        return date.formatted(.relative(presentation: .named))
    }
}
