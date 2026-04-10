// poller/src/sources/http.ts
import { get as httpsGet } from 'node:https'

const USER_AGENT = 'ai-tools-radar/1.0'
const MAX_REDIRECTS = 5

/**
 * Fetch a URL over HTTPS and return the response body as a UTF-8 string.
 * Follows 3xx redirects (up to MAX_REDIRECTS). Rejects on 4xx+ status.
 */
export function fetchHtml(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`))
      return
    }

    httpsGet(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      const status = res.statusCode ?? 0

      if (status >= 300 && status < 400 && res.headers.location) {
        fetchHtml(res.headers.location, redirectCount + 1).then(resolve, reject)
        return
      }

      if (status >= 400) {
        // Consume the stream so the socket is freed
        res.resume()
        reject(new Error(`HTTP ${status} for ${url}`))
        return
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    }).on('error', reject)
  })
}
