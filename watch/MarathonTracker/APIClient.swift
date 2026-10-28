import Foundation

struct SessionReply: Decodable {
    let session_id: UUID
    let waiting_point: WaitingPoint?
    let waiting_point_updated_at: Date?
    let server_time: Date
}
struct UploadReply: Decodable {
    let accepted_count: Int
    let acked_ids: [UUID]
    let waiting_point: WaitingPoint?
    let waiting_point_updated_at: Date?
    let server_time: Date
}
struct StopReply: Decodable { let status: String }
struct StartBody: Encodable {}
struct UploadBody: Encodable { let session_id: UUID; let points: [GPSPoint] }
struct StopBody: Encodable { let session_id: UUID }
enum APIError: Error { case configuration, credential, http(Int), invalidResponse }
struct APIClient: Sendable {
    let baseURL: URL
    let credential: String
    static func configured() throws -> APIClient {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "SupabaseFunctionsURL") as? String,
              let url = URL(string: raw), url.scheme == "https", url.host != nil else { throw APIError.configuration }
        guard let secret = DeviceKeychain.read() else { throw APIError.credential }
        return APIClient(baseURL: url, credential: secret)
    }
    func post<B: Encodable, R: Decodable>(_ endpoint: String, body: B) async throws -> R {
        var request = URLRequest(url: baseURL.appendingPathComponent(endpoint))
        request.httpMethod = "POST"
        request.timeoutInterval = 25
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard http.statusCode == 200 else { throw APIError.http(http.statusCode) }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter(); fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) { return date }
            throw APIError.invalidResponse
        }
        return try decoder.decode(R.self, from: data)
    }
}
