import { createHelia, type Helia } from 'helia'
import { unixfs } from '@helia/unixfs'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@libp2p/yamux'

let heliaInstance: Helia | null = null

export async function getHelia(): Promise<Helia> {
    if (!heliaInstance) {
        const libp2p = await createLibp2p({
            transports: [tcp(), webSockets()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()]
            // No DHT for now to keep it simple
        })

        heliaInstance = await createHelia({ libp2p })
        console.log('🚀 Helia IPFS node started (Node.js)')
    }

    return heliaInstance
}

export async function getUnixFs() {
    const helia = await getHelia()
    return unixfs(helia)
}