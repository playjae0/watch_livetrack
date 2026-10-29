import SwiftUI

@main struct MarathonTrackerApp: App {
    @StateObject private var tracker = Tracker()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup { TrackerView(tracker: tracker).onChange(of: phase) { _, value in if value == .active { tracker.pulse() } } }
    }
}
struct TrackerView: View {
    @ObservedObject var tracker: Tracker
    @State private var credential = ""
    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                if tracker.needsSetup {
                    Text("Device setup").font(.headline)
                    TextField("8-digit code", text: $credential)
                    Button("Connect") { tracker.setup(credential); credential = "" }.frame(minHeight: 48)
                } else if tracker.running {
                    Text(tracker.boosted ? "Boost · 1 minute" : "Sharing").font(.headline)
                    Button("Boost 1 min") { tracker.boost() }
                        .font(.title3.bold()).frame(maxWidth: .infinity, minHeight: 58)
                        .buttonStyle(.borderedProminent).tint(.orange).foregroundStyle(.black)
                    Text(tracker.distanceLabel).font(.caption)
                    Button("Stop sharing", role: .destructive) { tracker.stop() }.frame(minHeight: 48)
                } else if tracker.pendingStop {
                    Button("Retry stop", role: .destructive) { tracker.stop() }.frame(minHeight: 54)
                } else {
                    Button(tracker.hasSavedSession ? "Resume sharing" : "Start sharing") { tracker.start() }
                        .font(.title3.bold()).frame(maxWidth: .infinity, minHeight: 64)
                        .buttonStyle(.borderedProminent)
                    if tracker.hasSavedSession { Button("Stop sharing", role: .destructive) { tracker.stop() }.frame(minHeight: 44) }
                }
                Text(tracker.status).font(.caption).multilineTextAlignment(.center)
                if let last = tracker.lastUpload {
                    Text("Last upload \(last.formatted(date: .omitted, time: .standard))").font(.caption2)
                } else { Text("Last upload --").font(.caption2) }
            }.disabled(tracker.working).padding(.horizontal, 4)
        }
    }
}
