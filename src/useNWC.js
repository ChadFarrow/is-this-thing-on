import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { NWCClient } from '@getalby/sdk'

const TX_STORAGE_KEY = 'nwc_transactions'
const TX_MAX_STORED = 500

function loadStoredTx() {
  try {
    const raw = localStorage.getItem(TX_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveTx(transactions) {
  try {
    localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(transactions.slice(0, TX_MAX_STORED)))
  } catch { /* storage full — silently skip */ }
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
 * useNWC — connects via @getalby/sdk NWC client,
 * subscribes to real-time payment notifications, and falls back to polling.
 */
export function useNWC(nwcUri, pollIntervalMs = 5000) {
  const [status, setStatus] = useState('disconnected')
  const [error, setError] = useState(null)
  const [transactions, setTransactionsRaw] = useState(loadStoredTx)
  const [lastUpdated, setLastUpdated] = useState(null)

  const setTransactions = useCallback((update) => {
    setTransactionsRaw((prev) => {
      const next = typeof update === 'function' ? update(prev) : update
      saveTx(next)
      return next
    })
  }, [])

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

      // Merge fetched transactions into state, deduplicating by payment_hash
      const mergeTx = (fetched) => {
        setTransactions((prev) => {
          const byHash = new Map(prev.map((t) => [t.payment_hash, t]))
          let changed = false
          for (const t of fetched) {
            if (!byHash.has(t.payment_hash)) changed = true
            byHash.set(t.payment_hash, t)
          }
          if (!changed && fetched.length === 0) return prev
          return [...byHash.values()]
            .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
            .slice(0, TX_MAX_STORED)
        })
        setLastUpdated(new Date())
      }

      // Try to load history via list_transactions
      if (hasList) {
        try {
          const resp = await client.listTransactions({ limit: 50 })
          mergeTx(resp.transactions ?? [])
        } catch (e) {
          // Fall through to notifications
        }

        // Poll periodically to catch transactions missed while backgrounded
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = setInterval(async () => {
          try {
            const resp = await client.listTransactions({ limit: 50 })
            mergeTx(resp.transactions ?? [])
          } catch (e) {
            console.warn('[NWC] Poll error:', e.message)
          }
        }, pollIntervalMs)
      }

      if (hasNotifications) {
        const unsub = await client.subscribeNotifications(
          (notification) => {
            const tx = notification.notification
            if (tx) {
              if (tx.state?.toLowerCase() === 'failed') {
                console.warn('[NWC] Failed payment received via notification:', tx.payment_hash, tx)
              }
              setTransactions((prev) => {
                // Deduplicate by payment_hash
                const exists = prev.find(
                  (t) => t.payment_hash === tx.payment_hash
                )
                if (exists) return prev
                const updated = [tx, ...prev]
                return updated.slice(0, TX_MAX_STORED)
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
