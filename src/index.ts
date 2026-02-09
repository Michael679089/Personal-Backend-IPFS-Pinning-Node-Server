import { Elysia } from 'elysia'
import { getUnixFs } from './ipfs.js'
import { adminAuth } from './firebase-admin.js'
import { CID } from 'multiformats/cid'
import http, { IncomingMessage, ServerResponse } from 'node:http'

const app = new Elysia()
    .get('/', () => ({
        message: 'Node-based IPFS + Firebase backend running'
    }))

    .post('/ipfs/add', async ({ body }) => {
        const text = (body as any)?.text ?? 'hello from node + elysia + helia'
        const fs = await getUnixFs()
        const encoder = new TextEncoder()
        const cid = await fs.addBytes(encoder.encode(text))

        return { ok: true, cid: cid.toString() }
    })

    .get('/ipfs/cat/:cid', async ({ params }) => {
        const fs = await getUnixFs()
        const decoder = new TextDecoder()

        const cid = CID.parse(params.cid)

        const chunks: Uint8Array[] = []
        for await (const chunk of fs.cat(cid)) {
            chunks.push(chunk)
        }

        const size = chunks.reduce((n, c) => n + c.length, 0)
        const buf = new Uint8Array(size)
        let offset = 0
        for (const c of chunks) {
            buf.set(c, offset)
            offset += c.length
        }

        const text = decoder.decode(buf)
        return { ok: true, cid: params.cid, text }
    })

    .get('/protected', async ({ request }) => {
        const authHeader = request.headers.get('authorization') || ''
        const [, token] = authHeader.split(' ')

        if (!token) {
            return { ok: false, reason: 'no-token' }
        }

        try {
            const decoded = await adminAuth.verifyIdToken(token)
            return { ok: true, uid: decoded.uid }
        } catch (err) {
            console.error('Firebase verify error:', err)
            return { ok: false, reason: 'verify-failed' }
        }
    })

export default app

// Wrap app.fetch with Node's http server
const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
    const method = req.method ?? 'GET'

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
            for (const v of value) headers.append(key, v)
        } else if (value != null) {
            headers.set(key, String(value))
        }
    }

    const init: RequestInit = {
        method,
        headers
        // No `duplex` here; not part of DOM RequestInit types
    }

    // Attach body for non-GET/HEAD
    if (method !== 'GET' && method !== 'HEAD') {
        // Node’s IncomingMessage is a ReadableStream in Elysia’s runtime;
        // TS doesn't know that, so cast to any.
        (init as any).body = req as any
    }

    const fetchReq = new Request(url, init)

    const maybeResponse = app.fetch(fetchReq)

    const handleResponse = async (response: Response) => {
        res.statusCode = response.status
        response.headers.forEach((value: string, key: string) => {
            res.setHeader(key, value)
        })

        const body = response.body
        if (!body) {
            res.end()
            return
        }

        const reader = body.getReader()
        const pump = async (): Promise<void> => {
            const { done, value } = await reader.read()
            if (done) {
                res.end()
                return
            }
            res.write(Buffer.from(value))
            await pump()
        }

        await pump()
    }

    // app.fetch returns MaybePromise<Response>
    if (maybeResponse instanceof Promise) {
        maybeResponse
            .then((response: Response) => handleResponse(response))
            .catch((err: unknown) => {
                console.error('Error handling request:', err)
                res.statusCode = 500
                res.end('Internal Server Error')
            })
    } else {
        handleResponse(maybeResponse as Response).catch((err: unknown) => {
            console.error('Error handling request:', err)
            res.statusCode = 500
            res.end('Internal Server Error')
        })
    }
})

const PORT = 3000
server.listen(PORT, () => {
    console.log(`🦊 Node Elysia backend listening on http://localhost:${PORT}`)
})