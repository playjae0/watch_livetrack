import Foundation

struct GPSPoint: Codable, Equatable, Sendable, Identifiable {
    let id: UUID
    let seq: Int
    let latitude: Double
    let longitude: Double
    let horizontal_accuracy_m: Double
    let recorded_at: Date
}
struct WaitingPoint: Codable, Sendable {
    let latitude: Double
    let longitude: Double
    let updated_at: Date
}
struct SavedTracking: Codable, Sendable {
    var sessionID: UUID?
    var points: [GPSPoint] = []
    var nextSeq = 0
    var pendingStop = false
    var discardedCount = 0
}
struct UploadPolicy: Sendable {
    var boostUntil: Date?
    var lastAttempt: Date?
    var retryAfter: Date?
    var failures = 0
    mutating func boost(now: Date) { boostUntil = now.addingTimeInterval(60) }
    func boosted(now: Date) -> Bool { (boostUntil ?? .distantPast) > now }
    func interval(now: Date) -> TimeInterval { boosted(now: now) ? 5 : 30 }
    func due(now: Date) -> Bool {
        now >= (retryAfter ?? .distantPast) && now.timeIntervalSince(lastAttempt ?? .distantPast) >= interval(now: now)
    }
    func canAttempt(now: Date, force: Bool = false) -> Bool {
        now >= (retryAfter ?? .distantPast) && (force || due(now: now))
    }
    mutating func failed(now: Date, jitter: Double) {
        failures = min(failures + 1, 8)
        retryAfter = now.addingTimeInterval(min(300, pow(2, Double(failures))) + max(0, min(jitter, 3)))
    }
    mutating func succeeded() { failures = 0; retryAfter = nil }
}
struct QueueStore {
    let url: URL
    func load() throws -> SavedTracking {
        guard FileManager.default.fileExists(atPath: url.path) else { return SavedTracking() }
        return try JSONDecoder().decode(SavedTracking.self, from: Data(contentsOf: url))
    }
    func save(_ state: SavedTracking) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: url, options: .atomic)
    }
    static func acknowledge(_ ids: Set<UUID>, state: inout SavedTracking) {
        state.points.removeAll { ids.contains($0.id) }
    }
    // Keep newest 2,000 samples (~16h at 30s / ~2.8h at 5s); discard only under documented cap/age/stop policies.
    static func prune(state: inout SavedTracking, now: Date) {
        let count = state.points.count
        state.points.removeAll { now.timeIntervalSince($0.recorded_at) > 7 * 86400 }
        if state.points.count > 2000 { state.points.removeFirst(state.points.count - 2000) }
        state.discardedCount += count - state.points.count
    }
}
func validFix(latitude: Double, longitude: Double, accuracy: Double, recorded: Date, now: Date) -> Bool {
    latitude.isFinite && longitude.isFinite && accuracy.isFinite && (-90...90).contains(latitude)
        && (-180...180).contains(longitude) && (0...100).contains(accuracy)
        && now.timeIntervalSince(recorded) <= 90 && recorded.timeIntervalSince(now) <= 2
}
func straightLineMeters(_ a: GPSPoint, _ b: WaitingPoint) -> Double {
    let r = Double.pi / 180
    let dLat = (b.latitude - a.latitude) * r
    let dLon = (b.longitude - a.longitude) * r
    let h = pow(sin(dLat / 2), 2) + cos(a.latitude * r) * cos(b.latitude * r) * pow(sin(dLon / 2), 2)
    return 6371000 * 2 * asin(sqrt(min(1, max(0, h))))
}
