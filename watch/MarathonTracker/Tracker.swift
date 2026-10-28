import Foundation
import SwiftUI
import CoreLocation
import WatchKit
import Network

@MainActor final class Tracker: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published private(set) var running = false
    @Published private(set) var working = false
    @Published private(set) var status = "Not sharing"
    @Published private(set) var lastUpload: Date?
    @Published private(set) var waiting: WaitingPoint?
    @Published private(set) var lastFix: GPSPoint?
    @Published private(set) var boosted = false
    @Published private(set) var needsSetup = DeviceKeychain.read() == nil
    @Published private(set) var saved = SavedTracking()
    // Created on MainActor: Core Location delivers delegates on this same main run loop.
    private let manager = CLLocationManager()
    private var background: CLBackgroundActivitySession?
    private var policy = UploadPolicy()
    private var lastSampleTime: Date?
    private var awaitingFreshAfter: Date?
    private var boostTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var uploadTask: Task<Void, Never>?
    private var inFlight = false
    private var stopWanted = false
    private var storageFailed = false
    private let monitor = NWPathMonitor()
    private let store: QueueStore

    override init() {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        store = QueueStore(url: root.appendingPathComponent("tracking.json"))
        super.init()
        do { saved = try store.load(); status = saved.pendingStop ? "Stop pending · retry stop" : saved.sessionID == nil ? "Not sharing" : "Saved session · tap Resume" }
        catch { storageFailed = true; status = "Saved queue unreadable · repair storage before sharing" }
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 10
        manager.activityType = .fitness
        manager.allowsBackgroundLocationUpdates = true
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor [weak self] in self?.pulse() }
        }
        monitor.start(queue: DispatchQueue(label: "tracker.network"))
    }
    var hasSavedSession: Bool { saved.sessionID != nil }
    var pendingStop: Bool { saved.pendingStop }
    var distanceLabel: String {
        guard let lastFix, let waiting else { return "-- straight line" }
        let meters = straightLineMeters(lastFix, waiting)
        let old = Date().timeIntervalSince(waiting.updated_at) > 900 || Date().timeIntervalSince(lastFix.recorded_at) >= 90
        return "\(Int(meters.rounded())) m straight line\(old ? " · old" : "")"
    }
    func setup(_ credential: String) {
        guard credential.range(of: "^[A-Za-z0-9_-]{43,128}$", options: .regularExpression) != nil else { status = "Invalid device credential"; return }
        do { try DeviceKeychain.save(credential); needsSetup = false; status = "Ready" }
        catch { status = "Could not save credential" }
    }
    @discardableResult private func persist() -> Bool {
        do { try store.save(saved); return true }
        catch { storageFailed = true; running = false; manager.stopUpdatingLocation(); background?.invalidate(); background = nil; status = "Storage failed · sharing paused"; return false }
    }
    func start() {
        WKInterfaceDevice.current().play(.click)
        guard !working, !running, !saved.pendingStop, !storageFailed else { return }
        stopWanted = false
        switch manager.authorizationStatus {
        case .notDetermined: status = "Allow location to share"; manager.requestWhenInUseAuthorization(); return
        case .authorizedAlways, .authorizedWhenInUse: break
        default: status = "Allow Location in Watch Settings"; return
        }
        working = true; status = "Starting…"
        Task {
            defer { working = false }
            do {
                let reply: SessionReply = try await APIClient.configured().post("start-session", body: StartBody())
                guard !stopWanted else { return }
                if saved.sessionID != reply.session_id { saved = SavedTracking(sessionID: reply.session_id) }
                waiting = reply.waiting_point
                QueueStore.prune(state: &saved, now: Date())
                guard persist() else { return }
                policy = UploadPolicy(); lastSampleTime = nil; awaitingFreshAfter = Date()
                background = CLBackgroundActivitySession()
                running = true; manager.startUpdatingLocation()
                status = "Sharing · waiting for GPS"
                flush(force: true)
            } catch { show(error) }
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if running && manager.authorizationStatus != .authorizedWhenInUse && manager.authorizationStatus != .authorizedAlways {
            pause(); status = "Location permission removed · stop or resume"
        } else if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            // Explicit tap remains required; a permission callback never silently starts a saved session.
            if !running && !hasSavedSession { status = "Permission ready · tap Start" }
        }
    }
    func boost() {
        WKInterfaceDevice.current().play(.click)
        guard running, !stopWanted else { return }
        let now = Date(); policy.boost(now: now); boosted = true
        awaitingFreshAfter = now
        // Continuous acquisition stays on. Removing the distance filter requests subsequent fresh observations;
        // requestLocation() is intentionally avoided because it does nothing during standard updates.
        manager.distanceFilter = kCLDistanceFilterNone
        manager.desiredAccuracy = kCLLocationAccuracyBest
        status = "Boost · requesting fresh GPS"
        flush(force: true)
        boostTask?.cancel()
        boostTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(60))
            guard !Task.isCancelled else { return }
            self?.reconcileBoost()
        }
    }
    private func reconcileBoost() {
        let active = running && policy.boosted(now: Date())
        if boosted != active { boosted = active }
        if !active { manager.distanceFilter = 10; manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters }
    }
    func pulse() {
        reconcileBoost()
        if saved.pendingStop && !working { stop(buttonInput: false) }
        else if running { flush() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard running, !stopWanted else { return }
        reconcileBoost()
        let now = Date()
        var receivedFresh = false
        for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
            let c = location.coordinate
            guard validFix(latitude: c.latitude, longitude: c.longitude, accuracy: location.horizontalAccuracy, recorded: location.timestamp, now: now),
                  location.timestamp > (lastSampleTime ?? .distantPast) else { continue }
            let fresh = awaitingFreshAfter.map { location.timestamp >= $0 } ?? false
            guard fresh || location.timestamp.timeIntervalSince(lastSampleTime ?? .distantPast) >= policy.interval(now: now) else { continue }
            if awaitingFreshAfter != nil && !fresh { continue }
            let point = GPSPoint(id: UUID(), seq: saved.nextSeq, latitude: c.latitude, longitude: c.longitude, horizontal_accuracy_m: location.horizontalAccuracy, recorded_at: location.timestamp)
            saved.nextSeq += 1; saved.points.append(point); lastSampleTime = location.timestamp; lastFix = point
            if fresh { awaitingFreshAfter = nil; receivedFresh = true }
            QueueStore.prune(state: &saved, now: now)
            guard persist() else { return }
            status = "Queued · \(saved.points.count)"
        }
        flush(force: receivedFresh)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code != .locationUnknown { status = "GPS unavailable · queued points retained" }
    }
    private func flush(force: Bool = false) {
        let now = Date()
        guard running, !stopWanted, !inFlight, let session = saved.sessionID, !saved.points.isEmpty,
              policy.canAttempt(now: now, force: force) else { return }
        QueueStore.prune(state: &saved, now: now)
        guard persist(), !saved.points.isEmpty else { return }
        let batch = Array(saved.points.prefix(100))
        inFlight = true; policy.lastAttempt = now; status = "Attempting upload · \(batch.count)"
        uploadTask = Task {
            defer { inFlight = false; scheduleRetryIfNeeded() }
            do {
                let reply: UploadReply = try await APIClient.configured().post("ingest-location", body: UploadBody(session_id: session, points: batch))
                guard saved.sessionID == session else { return }
                let sent = Set(batch.map(\.id)), acked = Set(reply.acked_ids)
                guard acked.isSubset(of: sent) else { throw APIError.invalidResponse }
                QueueStore.acknowledge(acked, state: &saved)
                guard persist() else { return }
                policy.succeeded(); waiting = reply.waiting_point; lastUpload = Date()
                if !stopWanted { status = saved.points.isEmpty ? "Uploaded successfully" : "Uploaded · \(saved.points.count) queued" }
            } catch {
                policy.failed(now: Date(), jitter: Double.random(in: 0...3))
                if !stopWanted { show(error) }
            }
        }
    }
    private func scheduleRetryIfNeeded() {
        retryTask?.cancel()
        guard running, !stopWanted, !saved.points.isEmpty else { return }
        let due = max(policy.retryAfter ?? .distantPast, (policy.lastAttempt ?? Date()).addingTimeInterval(policy.interval(now: Date())))
        let delay = max(1, due.timeIntervalSinceNow)
        // One pending-work retry, never a background high-frequency repeating timer.
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }
    private func pause() {
        running = false; manager.stopUpdatingLocation(); background?.invalidate(); background = nil
        retryTask?.cancel(); boostTask?.cancel(); policy.boostUntil = nil; boosted = false
    }
    func stop(buttonInput: Bool = true) {
        if buttonInput { WKInterfaceDevice.current().play(.click) }
        guard !working, let session = saved.sessionID, !storageFailed else { return }
        stopWanted = true; pause(); saved.pendingStop = true
        guard persist() else { return }
        working = true; status = "Stopping…"
        Task {
            defer { working = false }
            // Let any in-flight ingest resolve before issuing stop, preserving unambiguous lifecycle.
            await uploadTask?.value
            do {
                let _: StopReply = try await APIClient.configured().post("stop-session", body: StopBody(session_id: session))
                saved = SavedTracking(); guard persist() else { return }
                waiting = nil; lastFix = nil; lastUpload = nil; status = "Sharing ended"
            } catch { status = "Stop pending · retry when online" }
        }
    }
    private func show(_ error: Error) {
        if case APIError.http(let code) = error {
            switch code {
            case 401, 403: pause(); if !hasSavedSession { needsSetup = true }; status = "Credential invalid or revoked"
            case 404, 409: pause(); status = "Session ended · stop or resume"
            case 429: status = "Rate limited · queued for retry"
            case 400: pause(); status = "Point rejected · queue retained"
            default: status = "Offline · queued for retry"
            }
        } else { status = "Connection unavailable · queued for retry" }
    }
}
