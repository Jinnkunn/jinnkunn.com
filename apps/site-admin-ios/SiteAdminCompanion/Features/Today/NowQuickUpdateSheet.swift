import SwiftUI

struct NowQuickUpdateSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var context = ""
    @State private var location = ""
    @State private var date = Date()
    @State private var nowPayload: SiteAdminNowPayload?
    @State private var selectedHistory: SiteAdminNowUpdate?
    @State private var isLoadingDetail = false
    @State private var isSaving = false
    @State private var deletingId: String?
    @State private var seededFromSummary = false

    private var history: [SiteAdminNowUpdate] {
        nowPayload?.data.updates ?? []
    }

    private var sourceFileSha: String? {
        nowPayload?.sourceVersion.fileSha
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Status") {
                    TextField("What are you doing now?", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                    DatePicker(
                        "Date",
                        selection: $date,
                        displayedComponents: .date
                    )
                }
                Section("Optional") {
                    TextField("Context", text: $context)
                    TextField("Location", text: $location)
                }
                Section {
                    if isLoadingDetail {
                        ProgressView("Loading history")
                    } else if history.isEmpty {
                        Text("No history yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(history) { item in
                            historyRow(item)
                        }
                    }
                } header: {
                    Text("History")
                } footer: {
                    Text("Deleting a history item does not delete the current Now status.")
                }
            }
            .navigationTitle("Update Now")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await saveCurrentNow() }
                    }
                    .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving || isLoadingDetail {
                        ProgressView()
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
        .sheet(item: $selectedHistory) { item in
            NowHistoryEditSheet(
                item: item,
                expectedFileSha: sourceFileSha,
                onSaved: applyPayload
            )
        }
        .onAppear {
            seedComposerFromSummary()
        }
        .task {
            await loadNowDetail()
        }
    }

    @ViewBuilder
    private func historyRow(_ item: SiteAdminNowUpdate) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.text)
                    .font(.body.weight(.medium))
                Text(compactDate(item.at))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button {
                selectedHistory = item
            } label: {
                Image(systemName: "pencil")
            }
            .buttonStyle(.borderless)
            .disabled(isSaving || deletingId != nil)
            Button(role: .destructive) {
                Task { await deleteHistory(item) }
            } label: {
                if deletingId == item.id {
                    ProgressView()
                } else {
                    Image(systemName: "trash")
                }
            }
            .buttonStyle(.borderless)
            .disabled(isSaving || deletingId != nil)
        }
        .padding(.vertical, 3)
    }

    private func seedComposerFromSummary() {
        guard !seededFromSummary else { return }
        seededFromSummary = true
        text = session.summary?.now.text ?? ""
        context = session.summary?.now.context ?? ""
        location = session.summary?.now.location ?? ""
        date = Date()
    }

    private func loadNowDetail() async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }
        guard let payload = await session.loadNowDetail() else { return }
        applyPayload(payload)
        text = payload.data.current.text
        context = payload.data.current.context ?? ""
        location = payload.data.current.location ?? ""
    }

    private func saveCurrentNow() async {
        isSaving = true
        defer { isSaving = false }
        guard let payload = await session.updateNow(
            text: text,
            context: context,
            location: location,
            date: date,
            expectedFileSha: sourceFileSha
        ) else {
            return
        }
        applyPayload(payload)
        dismiss()
    }

    private func deleteHistory(_ item: SiteAdminNowUpdate) async {
        deletingId = item.id
        defer { deletingId = nil }
        guard let payload = await session.deleteNowHistory(
            id: item.id,
            expectedFileSha: sourceFileSha
        ) else {
            return
        }
        applyPayload(payload)
    }

    private func applyPayload(_ payload: SiteAdminNowPayload) {
        nowPayload = payload
    }
}

private struct NowHistoryEditSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    let item: SiteAdminNowUpdate
    let expectedFileSha: String?
    let onSaved: (SiteAdminNowPayload) -> Void

    @State private var text: String
    @State private var date: Date
    @State private var isSaving = false

    init(
        item: SiteAdminNowUpdate,
        expectedFileSha: String?,
        onSaved: @escaping (SiteAdminNowPayload) -> Void
    ) {
        self.item = item
        self.expectedFileSha = expectedFileSha
        self.onSaved = onSaved
        _text = State(initialValue: item.text)
        _date = State(initialValue: parseNowDate(item.at))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("History item") {
                    TextField("Status", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                    DatePicker(
                        "Date",
                        selection: $date,
                        displayedComponents: .date
                    )
                }
            }
            .navigationTitle("Edit History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView()
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        guard let payload = await session.updateNowHistory(
            id: item.id,
            text: text,
            date: date,
            expectedFileSha: expectedFileSha
        ) else {
            return
        }
        onSaved(payload)
        dismiss()
    }
}

private func parseNowDate(_ iso: String?) -> Date {
    guard let iso, !iso.isEmpty else { return Date() }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: iso) {
        return date
    }
    return ISO8601DateFormatter().date(from: iso) ?? Date()
}

private func compactDate(_ iso: String) -> String {
    parseNowDate(iso).formatted(.dateTime.month(.abbreviated).day().hour().minute())
}
