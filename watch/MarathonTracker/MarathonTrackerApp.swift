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
        VStack(spacing: 2) {
            if tracker.needsSetup {
                Text("Device setup").font(.caption.bold()).lineLimit(1)
                TextField("8-digit code", text: $credential)
                    .controlSize(.small)
                Button("Connect") { tracker.setup(credential); credential = "" }
                    .controlSize(.small).frame(minHeight: 44)
            } else if tracker.running {
                Text(tracker.boosted ? "Boost · 1 minute" : "Sharing")
                    .font(.caption.bold()).lineLimit(1)
                Button { tracker.boost() } label: {
                    Text("Boost 1 min").font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.borderedProminent).controlSize(.small)
                .tint(.orange).foregroundStyle(.black)
                Text(tracker.distanceLabel)
                    .font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
                Button("Stop sharing", role: .destructive) { tracker.stop() }
                    .controlSize(.small).frame(minHeight: 44)
            } else if tracker.pendingStop {
                Button("Retry stop", role: .destructive) { tracker.stop() }
                    .controlSize(.small).frame(minHeight: 44)
            } else {
                Button { tracker.start() } label: {
                    Text(tracker.hasSavedSession ? "Resume sharing" : "Start sharing")
                        .font(.system(size: 16, weight: .bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent).controlSize(.small)
                if tracker.hasSavedSession {
                    Button("Stop sharing", role: .destructive) { tracker.stop() }
                        .controlSize(.small).frame(minHeight: 44)
                }
            }
            Text(tracker.status)
                .font(.system(size: 11)).lineLimit(1).minimumScaleFactor(0.7)
            if let last = tracker.lastUpload {
                Text("Last upload \(last.formatted(date: .omitted, time: .standard))")
                    .font(.system(size: 10)).lineLimit(1).minimumScaleFactor(0.7)
            } else {
                Text("Last upload --").font(.system(size: 10)).lineLimit(1)
            }
        }
        .disabled(tracker.working)
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}
