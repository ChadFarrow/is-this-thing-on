import { decode } from 'light-bolt11-decoder'

/**
 * Decode a BOLT11 invoice and return the destination pubkey.
 * Returns null if the invoice is missing or unparseable.
 */
export function decodeBolt11(invoice) {
  if (!invoice) return null
  try {
    const decoded = decode(invoice)
    const destSection = decoded.sections.find((s) => s.name === 'destination')
    if (destSection?.value) return destSection.value

    // Fallback: payee_node_key is sometimes used
    const payee = decoded.sections.find((s) => s.name === 'payee_node_key')
    return payee?.value ?? null
  } catch {
    return null
  }
}

// Simple in-memory cache so we don't re-fetch the same pubkey
const aliasCache = new Map()
const pendingFetches = new Map()

/**
 * Look up a Lightning node alias from mempool.space.
 * Returns the alias string, or a truncated pubkey if not found.
 * Uses an in-memory cache to avoid repeated fetches.
 */
export async function lookupNodeAlias(pubkey) {
  if (!pubkey) return null

  if (aliasCache.has(pubkey)) return aliasCache.get(pubkey)

  // Deduplicate concurrent fetches for the same pubkey
  if (pendingFetches.has(pubkey)) return pendingFetches.get(pubkey)

  const fetchPromise = (async () => {
    try {
      const res = await fetch(`https://mempool.space/api/v1/lightning/nodes/${pubkey}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error('Not found')
      const data = await res.json()
      const alias = data.alias || shortPubkey(pubkey)
      aliasCache.set(pubkey, alias)
      return alias
    } catch {
      const fallback = shortPubkey(pubkey)
      aliasCache.set(pubkey, fallback)
      return fallback
    } finally {
      pendingFetches.delete(pubkey)
    }
  })()

  pendingFetches.set(pubkey, fetchPromise)
  return fetchPromise
}

export function shortPubkey(pubkey) {
  if (!pubkey || pubkey.length < 16) return pubkey ?? '—'
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`
}
