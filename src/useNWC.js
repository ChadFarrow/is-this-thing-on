import { useState, useEffect, useRef, useCallback } from 'react'
import { NWCClient } from '@getalby/sdk'

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
 * useNWC — connects via @getalby/sdk NWC client,
 * subscribes to real-time payment notifications, and falls back to polling.
 */
export function useNWC(nwcUri, pollIntervalMs = 5000) {
  const [status, setStatus] = useState('disconnected')
  const [error, setError] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)

  const clientRef = useRef(null)
  const pollTimerRef = useRef(null)
  const unsubRef = useRef(null)

  const disconnect = useCallback(() => {
    clearInterval(pollTimerRef.current)
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }
    if (clientRef.current) {
      clientRef.current.close()
      clientRef.current = null
    }
    setStatus('disconnected')
    setTransactions([])
  }, [])

  const connect = useCallback(async (uri) => {
    try {
      setStatus('connecting')
      setError(null)

      const client = new NWCClient({ nostrWalletConnectUrl: uri })
      clientRef.current = client

      // Test connectivity with get_info
      const info = await client.getInfo()
      console.log('[NWC] Connected to', info.alias || 'wallet')
      setStatus('connected')

      // Try list_transactions first (works on self-hosted AlbyHub)
      const hasList = info.methods?.includes('list_transactions')
      const hasNotifications = info.notifications?.length > 0

      // Try to load history via list_transactions
      if (hasList) {
        try {
          const resp = await client.listTransactions({ limit: 50 })
          setTransactions(resp.transactions ?? [])
          setLastUpdated(new Date())
        } catch (e) {
          // Fall through to notifications
        }
      }

      if (hasNotifications) {
        const unsub = await client.subscribeNotifications(
          (notification) => {
            const tx = notification.notification
            if (tx) {
              setTransactions((prev) => {
                // Deduplicate by payment_hash
                const exists = prev.find(
                  (t) => t.payment_hash === tx.payment_hash
                )
                if (exists) return prev
                const updated = [tx, ...prev]
                return updated.slice(0, 200) // keep last 200
              })
              setLastUpdated(new Date())
            }
          },
          ['payment_received', 'payment_sent']
        )
        unsubRef.current = unsub
      }

      if (!hasList && !hasNotifications) {
        setError('Wallet does not support transaction listing or notifications. Try a connection with more permissions.')
      }
    } catch (e) {
      console.error('[NWC] Connection error:', e)
      setStatus('error')
      setError(e.message)
    }
  }, [pollIntervalMs])

  useEffect(() => () => disconnect(), [disconnect])

  return { status, error, transactions, lastUpdated, connect, disconnect }
}
