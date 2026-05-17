import SwiftUI

struct NowQuickUpdateSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var context = ""
    @State private var location = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Status") {
                    TextField("What are you doing now?", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                }
                Section("Optional") {
                    TextField("Context", text: $context)
                    TextField("Location", text: $location)
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
                        Task {
                            let ok = await session.updateNow(
                                text: text,
                                context: context,
                                location: location
                            )
                            if ok { dismiss() }
                        }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .onAppear {
            text = session.summary?.now.text ?? ""
            context = session.summary?.now.context ?? ""
            location = session.summary?.now.location ?? ""
        }
    }
}
