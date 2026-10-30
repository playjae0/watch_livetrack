import Foundation

@main struct CoreTests {
    static func main() throws {
        let t = Date(timeIntervalSince1970: 10000)
        var policy = UploadPolicy()
        assert(policy.interval(now: t) == 10)
        policy.lastAttempt = t
        assert(!policy.due(now: t.addingTimeInterval(9)))
        assert(policy.due(now: t.addingTimeInterval(10)))
        policy.boost(now: t)
        assert(policy.canAttempt(now: t, force: true)) // immediate queued attempt without fabricating a fix
        assert(policy.interval(now: t.addingTimeInterval(59)) == 5)
        assert(policy.interval(now: t.addingTimeInterval(60)) == 10)
        policy.boost(now: t.addingTimeInterval(59))
        assert(policy.boosted(now: t.addingTimeInterval(100)))
        assert(!policy.boosted(now: t.addingTimeInterval(119)))
        policy.failed(now: t, jitter: 1)
        assert(!policy.canAttempt(now: t.addingTimeInterval(2), force: true))
        assert(policy.canAttempt(now: t.addingTimeInterval(3), force: true))
        policy.succeeded(); assert(policy.retryAfter == nil)
        func point(_ seq: Int) -> GPSPoint {
            GPSPoint(id: UUID(), seq: seq, latitude: 0, longitude: 0, horizontal_accuracy_m: 10, recorded_at: t)
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = QueueStore(url: dir.appendingPathComponent("tracking.json"))
        let p0 = point(0), p1 = point(1)
        var state = SavedTracking(sessionID: UUID(), points: [p0, p1], nextSeq: 2)
        try store.save(state)
        let initialLoad = try store.load()
        assert(initialLoad.points == [p0, p1])
        QueueStore.acknowledge([p0.id], state: &state)
        assert(state.points == [p1]) // missing acknowledgments remain durable
        try store.save(state)
        var reloaded = try store.load()
        assert(reloaded.sessionID == state.sessionID && reloaded.points == [p1])
        reloaded.pendingStop = true; try store.save(reloaded)
        let stopLoad = try store.load()
        assert(stopLoad.pendingStop)
        state.points = (0..<2005).map(point)
        QueueStore.prune(state: &state, now: t)
        assert(state.points.count == 2000 && state.points[0].seq == 5 && state.discardedCount == 5)
        assert(validFix(latitude: 0, longitude: 0, accuracy: 100, recorded: t, now: t))
        assert(!validFix(latitude: 91, longitude: 0, accuracy: 10, recorded: t, now: t))
        assert(!validFix(latitude: 0, longitude: 0, accuracy: -1, recorded: t, now: t))
        assert(!validFix(latitude: 0, longitude: 0, accuracy: 10, recorded: t.addingTimeInterval(-91), now: t))
        let destination = WaitingPoint(latitude: 0, longitude: 1, updated_at: t)
        assert(abs(straightLineMeters(p0, destination) - 111194.9) < 1)
        print("PASS A08/A09/A13/A15: boost, backoff, atomic queue/relaunch, partial ack, cap, GPS validation, straight-line distance")
    }
}
