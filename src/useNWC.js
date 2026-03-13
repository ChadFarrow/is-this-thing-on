import { useState, useEffect, useRef, useCallback } from 'react'
import { generateSecretKey, getPublicKey, nip04, finalizeEvent } from 'nostr-tools'

/**
 * Parse a NWC URI into its components.
 * Format: nostr+walletconnect://<walletPubkey>?relay=<relay>&secret=<secret>
 */
export function parseNWCUri(uri) {
  try {
    const cleaned = uri.trim()
    if (!cleaned.startsWith('nostr+walletconnect://')) {
      throw new Error('Not a valid NWC URI')
    }
    const withoutScheme = cleaned.replace('nostr+walletconnect://', '')
    const [walletPubkey, queryString] = withoutScheme.split('?')
    const params = new URLSearchParams(queryString)
    const relay = params.get('relay')
    const secret = params.get('secret')
    if (!walletPubkey || !relay || !secret) {
      throw new Error('Missing required NWC URI fields')
    }
    return { walletPubkey, relay, secret }
  } catch (e) {
    throw new Error(`Failed to parse NWC URI: ${e.message}`)
  }
}

/**
 * Format msats to a readable sats string.
 */
export function msatsToSats(msats) {
  if (!msats && msats !== 0) return '—'
  const sats = msats / 1000
  if (sats >= 1000000) return `${(sats / 1000000).toFixed(2)}M`
  if (sats >= 1000) return `${(sats / 1000).toFixed(1)}k`
  return sats.toFixed(sats < 1 ? 3 : 0)
}

/**
 * useNWC — manages a single persistent WebSocket connection to an NWC relay,
 * sends list_transactions requests, and returns parsed payment data.
 */
export function useNWC(nwcUri, pollIntervalMs = 5000) {
  const [status, setStatus] = useState('disconnected') // disconnected | connecting | connected | error
  const [error, setError] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)

  const wsRef = useRef(null)
  const pollTimerRef = useRef(null)
  const parsedRef = useRef(null)
  const pendingRequests = useRef({}) // eventId -> resolve

  const disconnect = useCallback(() => {
    clearInterval(pollTimerRef.current)
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('disconnected')
  }, [])

  const sendListTransactions = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const { walletPubkey, secret } = parsedRef.current

    const secretKeyBytes = hexToBytes(secret)
    const clientPubkey = getPublicKey(secretKeyBytes)

    const requestPayload = JSON.stringify({
      method: 'list_transactions',
      params: { limit: 50 },
    })

    const encrypted = await nip04.encrypt(secret, walletPubkey, requestPayload)

    const event = finalizeEvent(
      {
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', walletPubkey]],
        content: encrypted,
      },
      secretKeyBytes
    )

    // Subscribe for the response
    const subId = randomHex(8)
    const msg = JSON.stringify([
      'REQ',
      subId,
      {
        kinds: [23195],
        authors: [walletPubkey],
        '#e': [event.id],
        since: Math.floor(Date.now() / 1000) - 10,
      },
    ])

    pendingRequests.current[event.id] = { subId, clientPubkey }

    wsRef.current.send(JSON.stringify(['EVENT', event]))
    wsRef.current.send(msg)
  }, [])

  const connect = useCallback(async (uri) => {
    try {
      setStatus('connecting')
      setError(null)
      const parsed = parseNWCUri(uri)
      parsedRef.current = parsed

      const ws = new WebSocket(parsed.relay)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('connected')
        sendListTransactions()
        pollTimerRef.current = setInterval(sendListTransactions, pollIntervalMs)
      }

      ws.onmessage = async (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (!Array.isArray(msg)) return

          const [type, , event] = msg
          if (type !== 'EVENT' || !event || event.kind !== 23195) return

          // Find which request this is a response to
          const eTag = event.tags.find((t) => t[0] === 'e')
          if (!eTag) return
          const requestEventId = eTag[1]
          const pending = pendingRequests.current[requestEventId]
          if (!pending) return

          // Decrypt
          const { secret } = parsedRef.current
          const decrypted = await nip04.decrypt(secret, event.pubkey, event.content)
          const response = JSON.parse(decrypted)

          if (response.error) {
            console.warn('NWC error response:', response.error)
            return
          }

          const txs = response.result?.transactions ?? []
          setTransactions(txs)
          setLastUpdated(new Date())

          // Clean up subscription
          ws.send(JSON.stringify(['CLOSE', pending.subId]))
          delete pendingRequests.current[requestEventId]
        } catch (e) {
          console.error('Error processing NWC message:', e)
        }
      }

      ws.onerror = (e) => {
        setStatus('error')
        setError('WebSocket connection failed. Check your relay URL.')
      }

      ws.onclose = () => {
        setStatus('disconnected')
        clearInterval(pollTimerRef.current)
      }
    } catch (e) {
      setStatus('error')
      setError(e.message)
    }
  }, [sendListTransactions, pollIntervalMs])

  // Cleanup on unmount
  useEffect(() => () => disconnect(), [disconnect])

  return { status, error, transactions, lastUpdated, connect, disconnect }
}

// Helpers
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
