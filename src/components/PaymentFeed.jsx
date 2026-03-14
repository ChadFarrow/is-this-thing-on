import { useState, useMemo, useEffect } from 'react'
import { msatsToSats } from '../useNWC'
import { decodeBolt11, lookupNodeAlias, shortPubkey } from '../lightning'
import styles from './PaymentFeed.module.css'

const STATE_FILTERS = ['all', 'failed', 'succeeded', 'pending']

export default function PaymentFeed({ transactions, lastUpdated, onClear }) {
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [rssMetaMap, setRssMetaMap] = useState(new Map())

  // Fetch metadata for all rss::payment URLs in transactions
  useEffect(() => {
    const urls = new Set()
    transactions.forEach((tx) => {
      const rss = parseRssPayment(tx.description || tx.memo)
      if (rss?.url) urls.add(rss.url)
    })
    if (urls.size === 0) return

    let cancelled = false
    const promises = [...urls].map((url) =>
      fetchRssPaymentMeta(url).then((meta) => [url, meta])
    )
    Promise.all(promises).then((results) => {
      if (cancelled) return
      const map = new Map()
      for (const [url, meta] of results) {
        if (meta) map.set(url, meta)
      }
      setRssMetaMap((prev) => {
        if (map.size === 0 && prev.size === 0) return prev
        return new Map([...prev, ...map])
      })
    })
    return () => { cancelled = true }
  }, [transactions])

  const counts = useMemo(() => {
    const c = { all: 0, failed: 0, succeeded: 0, pending: 0 }
    transactions.forEach((tx) => {
      c.all++
      const s = normalizeState(tx.state)
      if (s === 'failed') c.failed++
      else if (s === 'succeeded') c.succeeded++
      else c.pending++
    })
    return c
  }, [transactions])

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      const s = normalizeState(tx.state)
      const matchState = filter === 'all' || filter === s
      const matchType = typeFilter === 'all' || typeFilter === tx.type
      return matchState && matchType
    })
  }, [transactions, filter, typeFilter])

  const grouped = useMemo(() => {
    const groups = new Map()
    const ungrouped = []

    // Group by V4V metadata or rss::payment metadata
    const needsClustering = new Map()
    filtered.forEach((tx) => {
      const v4v = parseV4V(tx.metadata)
      if (v4v && v4v.action) {
        if (v4v.ts) {
          const key = `${v4v.action}|${v4v.podcast || ''}|${v4v.episode || ''}|${v4v.ts}`
          if (!groups.has(key)) groups.set(key, { type: 'group', key, v4v, splits: [], time: 0 })
          const group = groups.get(key)
          group.splits.push({ tx, v4v })
          group.time = Math.max(group.time, tx.created_at || 0)
        } else {
          const contextKey = `${v4v.action}|${v4v.podcast || ''}|${v4v.episode || ''}`
          if (!needsClustering.has(contextKey)) needsClustering.set(contextKey, [])
          needsClustering.get(contextKey).push({ tx, v4v })
        }
        return
      }

      // Check for rss::payment with fetched metadata
      const rss = parseRssPayment(tx.description || tx.memo)
      const meta = rss?.url ? rssMetaMap.get(rss.url) : null
      if (meta && (meta.action || rss.action)) {
        const action = meta.action || rss.action
        const podcast = meta.podcast || ''
        const episode = meta.episode || ''
        const asV4v = { action, podcast, episode, sender_name: meta.sender_name, app_name: meta.app_name, message: meta.message, rssMeta: meta }
        // Use time-proximity clustering for incoming rss::payment splits
        const contextKey = `rss|${action}|${podcast}|${episode}`
        if (!needsClustering.has(contextKey)) needsClustering.set(contextKey, [])
        needsClustering.get(contextKey).push({ tx, v4v: asV4v })
        return
      }

      ungrouped.push({ type: 'tx', tx })
    })

    // Time-proximity clustering for payments without ts
    needsClustering.forEach((items, contextKey) => {
      items.sort((a, b) => (a.tx.created_at || 0) - (b.tx.created_at || 0))
      let cluster = [items[0]]
      for (let i = 1; i < items.length; i++) {
        const gap = (items[i].tx.created_at || 0) - (items[i - 1].tx.created_at || 0)
        if (gap <= 60) {
          cluster.push(items[i])
        } else {
          const key = `${contextKey}|${cluster[0].tx.created_at}`
          groups.set(key, { type: 'group', key, v4v: cluster[0].v4v, splits: cluster, time: cluster[cluster.length - 1].tx.created_at })
          cluster = [items[i]]
        }
      }
      const key = `${contextKey}|${cluster[0].tx.created_at}`
      groups.set(key, { type: 'group', key, v4v: cluster[0].v4v, splits: cluster, time: cluster[cluster.length - 1].tx.created_at })
    })

    const result = []
    groups.forEach((group) => {
      if (group.splits.length === 1) {
        result.push({ type: 'tx', tx: group.splits[0].tx, sortTime: group.time })
      } else {
        let succeeded = 0, failed = 0, totalAmt = 0, totalFees = 0
        for (const s of group.splits) {
          const st = normalizeState(s.tx.state)
          if (st === 'succeeded') succeeded++
          else if (st === 'failed') failed++
          totalAmt += s.tx.amount || 0
          totalFees += s.tx.fees_paid || 0
        }
        group.succeededCount = succeeded
        group.failedCount = failed
        group.totalAmount = totalAmt
        group.totalFees = totalFees
        group.sortTime = group.time
        result.push(group)
      }
    })
    ungrouped.forEach((item) => {
      item.sortTime = item.tx.created_at
      result.push(item)
    })

    result.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0))
    return result
  }, [filtered, rssMetaMap])

  if (transactions.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>⚡</div>
        <p>Waiting for transactions...</p>
        <p className={styles.emptyHint}>Connect your NWC string above to start monitoring.</p>
      </div>
    )
  }

  return (
    <div className={styles.feed}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {STATE_FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.active : ''} ${f === 'failed' && counts.failed > 0 ? styles.hasFailed : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.toUpperCase()}
              <span className={styles.count}>{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className={styles.right}>
          <select
            className={styles.select}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">ALL TYPES</option>
            <option value="outgoing">OUTGOING</option>
            <option value="incoming">INCOMING</option>
          </select>
          {lastUpdated && (
            <span className={styles.lastUpdated}>
              updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {onClear && transactions.length > 0 && (
            <button className={styles.clearBtn} onClick={() => { if (window.confirm('Clear all transaction history?')) onClear() }} title="Clear transaction history">
              CLEAR
            </button>
          )}
        </div>
      </div>

      {counts.failed > 0 && filter !== 'failed' && (
        <div className={styles.failBanner} onClick={() => setFilter('failed')}>
          <span>⚠</span>
          <span>{counts.failed} failed payment{counts.failed !== 1 ? 's' : ''} detected</span>
          <span className={styles.viewFailed}>VIEW →</span>
        </div>
      )}

      <div className={styles.table}>
        <div className={styles.thead}>
          <div className={`${styles.col} ${styles.colState}`}>STATE</div>
          <div className={`${styles.col} ${styles.colType}`}>TYPE</div>
          <div className={`${styles.col} ${styles.colDest}`}>DESTINATION</div>
          <div className={`${styles.col} ${styles.colDesc}`}>DESCRIPTION</div>
          <div className={`${styles.col} ${styles.colAmount}`}>AMOUNT</div>
          <div className={`${styles.col} ${styles.colFees}`}>FEES</div>
          <div className={`${styles.col} ${styles.colTime}`}>TIME</div>
        </div>
        <div className={styles.tbody}>
          {grouped.length === 0 ? (
            <div className={styles.noResults}>No transactions match this filter.</div>
          ) : (
            grouped.map((item, i) =>
              item.type === 'group' ? (
                <GroupRow key={item.key} group={item} />
              ) : (
                <TransactionRow key={item.tx.payment_hash ?? i} tx={item.tx} />
              )
            )
          )}
        </div>
      </div>
    </div>
  )
}

function GroupRow({ group }) {
  const [expanded, setExpanded] = useState(false)
  const { v4v, splits, succeededCount, failedCount, totalAmount, totalFees } = group
  const total = splits.length
  const allOk = succeededCount === total
  const hasFails = failedCount > 0

  const icon = actionIcon(v4v.action)
  const time = group.time ? new Date(group.time * 1000).toLocaleTimeString() : '—'
  const totalSats = msatsToSats(totalAmount)

  const ratioClass = allOk ? styles.ratioOk : hasFails ? styles.ratioFail : styles.ratioPending
  const groupRowClass = hasFails ? styles.groupRowFailed : styles.groupRow

  return (
    <>
      <div className={`${styles.row} ${groupRowClass}`} onClick={() => setExpanded(!expanded)}>
        <div className={`${styles.cell} ${styles.cellState}`}>
          <span className={`${styles.stateTag} ${ratioClass}`}>
            {succeededCount}/{total} {allOk ? '✓' : hasFails ? '!' : '…'}
          </span>
        </div>
        <div className={`${styles.cell} ${styles.cellType}`}>
          <span className={styles.typeTag}>{icon} {v4v.action?.toUpperCase() || '—'}</span>
        </div>
        <div className={`${styles.cell} ${styles.destCell} ${styles.cellDest}`}>
          <span className={styles.destAlias}>{v4v.podcast || '—'}</span>
        </div>
        <div className={`${styles.cell} ${styles.descCell} ${styles.cellDesc}`}>
          {v4v.rssMeta ? (v4v.episode || v4v.message || '—') : (v4v.message || v4v.episode || '—')}
        </div>
        <div className={`${styles.cell} ${styles.cellAmount}`}>
          <span className={styles.amount}>{totalSats} <span className={styles.unit}>sats</span></span>
        </div>
        <div className={`${styles.cell} ${styles.cellFees}`}>
          {totalFees > 0 ? msatsToSats(totalFees) : '—'}
        </div>
        <div className={`${styles.cell} ${styles.cellTime}`}>
          {expanded ? '▾' : '▸'} {time}
        </div>
      </div>

      {expanded && (
        <div className={styles.groupDetail}>
          <div className={styles.groupMeta}>
            {v4v.sender_name && <span>From: <strong>{v4v.sender_name}</strong></span>}
            {v4v.app_name && <span>via {v4v.app_name}{v4v.rssMeta?.app_version ? ` v${v4v.rssMeta.app_version}` : ''}</span>}
            {v4v.podcast && <span>Podcast: {v4v.podcast}</span>}
            {v4v.episode && <span>Episode: {v4v.episode}</span>}
            {v4v.rssMeta?.position != null && <span>Position: {formatPosition(v4v.rssMeta.position)}</span>}
            {v4v.message && <span>Message: {v4v.message}</span>}
          </div>
          <div className={styles.splitList}>
            {splits.map((s, i) => {
              const st = normalizeState(s.tx.state)
              const { label: stLabel, cls: stCls } = stateDisplay(st)
              return (
                <div key={s.tx.payment_hash ?? i} className={`${styles.splitRow} ${st === 'failed' ? styles.splitRowFailed : ''}`}>
                  <span className={`${styles.stateTag} ${stCls}`} style={{ width: '50px', textAlign: 'center' }}>{stLabel}</span>
                  <span className={styles.splitName}>{s.v4v?.name || s.v4v?.rssMeta?.recipient_name || '—'}</span>
                  <span className={styles.splitAmount}>{msatsToSats(s.tx.amount)} sats</span>
                  <span className={styles.splitFees}>{s.tx.fees_paid !== undefined ? `${msatsToSats(s.tx.fees_paid)} fee` : ''}</span>
                  {s.tx.error_message && <span className={styles.splitError}>{s.tx.error_message}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

function TransactionRow({ tx }) {
  const [expanded, setExpanded] = useState(false)
  const [destAlias, setDestAlias] = useState(null)
  const [destPubkey, setDestPubkey] = useState(null)
  const [decoded, setDecoded] = useState(false)
  const [rssMeta, setRssMeta] = useState(null)

  const state = normalizeState(tx.state)
  const isFailed = state === 'failed'
  const isSuccess = state === 'succeeded'
  const isIncoming = tx.type === 'incoming'

  useEffect(() => {
    let cancelled = false
    const v4v = parseV4V(tx.metadata)

    if (isIncoming) {
      // For incoming payments, show sender info (not the destination, which is our own node)
      const senderName = v4v?.sender_name || v4v?.app_name || null
      if (senderName) setDestAlias(senderName)
      setDecoded(true)
    } else {
      // For outgoing payments, show the recipient
      const v4vName = v4v?.name || null
      if (v4vName) {
        setDestAlias(v4vName)
      }

      // Try multiple sources for the destination pubkey
      const pubkey = decodeBolt11(tx.invoice)
        || tx.metadata?.destination
        || tx.metadata?.pubkey
        || tx.destination
        || null

      if (pubkey) {
        setDestPubkey(pubkey)
        if (!v4vName) {
          lookupNodeAlias(pubkey).then((alias) => {
            if (!cancelled) { setDestAlias(alias); setDecoded(true) }
          })
        } else {
          setDecoded(true)
        }
      } else {
        setDecoded(true)
      }
    }

    return () => { cancelled = true }
  }, [tx.invoice, tx.metadata, isIncoming])

  // Fetch metadata from rss::payment URL (e.g. Castamatic boost URLs)
  const rssPayment = parseRssPayment(tx.description || tx.memo)
  useEffect(() => {
    if (!rssPayment?.url) return
    let cancelled = false
    fetchRssPaymentMeta(rssPayment.url).then((meta) => {
      if (!cancelled && meta) {
        setRssMeta(meta)
        const name = isIncoming ? (meta.sender_name || meta.podcast) : meta.recipient_name
        if (name) setDestAlias((prev) => prev ?? name)
      }
    })
    return () => { cancelled = true }
  }, [rssPayment?.url, isIncoming])

  const rowClass = isFailed ? styles.rowFailed : isIncoming ? styles.rowIncoming : isSuccess ? styles.rowSuccess : styles.rowPending
  const { label: stateLabel, cls: stateClass } = stateDisplay(state)

  const desc = rssMeta?.episode || rssPayment?.message || tx.description || tx.memo || '—'
  const time = tx.created_at ? new Date(tx.created_at * 1000).toLocaleTimeString() : '—'
  // Fallback: extract hostname from rss::payment description if no destination resolved
  const destDisplay = destAlias
    ?? (destPubkey ? shortPubkey(destPubkey) : null)
    ?? (rssPayment?.url ? new URL(rssPayment.url).hostname.replace(/^www\./, '') : null)

  const actionType = rssMeta?.action || rssPayment?.action || null
  const typeLabel = actionType
    ? `${actionIcon(actionType)} ${actionType.toUpperCase()}`
    : tx.type === 'outgoing' ? '↑ OUT' : '↓ IN'

  return (
    <>
      <div className={`${styles.row} ${rowClass}`} onClick={() => setExpanded(!expanded)}>
        <div className={`${styles.cell} ${styles.cellState}`}>
          <span className={`${styles.stateTag} ${stateClass}`}>{stateLabel}</span>
        </div>
        <div className={`${styles.cell} ${styles.cellType}`}>
          <span className={styles.typeTag}>{typeLabel}</span>
        </div>
        <div className={`${styles.cell} ${styles.destCell} ${styles.cellDest}`}>
          {destDisplay ? (
            <span className={styles.destAlias} title={destPubkey}>{destDisplay}</span>
          ) : !decoded && tx.type === 'outgoing' ? (
            <span className={styles.destUnknown}>decoding…</span>
          ) : (
            <span className={styles.destUnknown}>—</span>
          )}
        </div>
        <div className={`${styles.cell} ${styles.descCell} ${styles.cellDesc}`}>
          {desc}
        </div>
        <div className={`${styles.cell} ${styles.cellAmount}`}>
          <span className={styles.amount}>{msatsToSats(tx.amount)} <span className={styles.unit}>sats</span></span>
        </div>
        <div className={`${styles.cell} ${styles.cellFees}`}>
          {tx.fees_paid !== undefined ? msatsToSats(tx.fees_paid) : '—'}
        </div>
        <div className={`${styles.cell} ${styles.cellTime}`}>
          {time}
        </div>
      </div>

      {expanded && (
        <div className={styles.detail}>
          {rssMeta && (
            <>
              {rssMeta.podcast && <DetailRow label="Podcast" value={rssMeta.podcast} highlight />}
              {rssMeta.episode && <DetailRow label="Episode" value={rssMeta.episode} />}
              {rssMeta.sender_name && <DetailRow label="Sender" value={rssMeta.sender_name} />}
              {rssMeta.recipient_name && <DetailRow label="Recipient" value={rssMeta.recipient_name} />}
              {rssMeta.app_name && <DetailRow label="App" value={rssMeta.app_version ? `${rssMeta.app_name} v${rssMeta.app_version}` : rssMeta.app_name} />}
              {rssMeta.message && <DetailRow label="Message" value={rssMeta.message} />}
              {rssMeta.position != null && <DetailRow label="Position" value={formatPosition(rssMeta.position)} />}
              {rssMeta.value_msat_total != null && <DetailRow label="Total Boost" value={`${msatsToSats(rssMeta.value_msat_total)} sats`} />}
              {rssMeta.split != null && <DetailRow label="Split %" value={`${rssMeta.split}%`} />}
              {rssMeta.feed_guid && <DetailRow label="Feed GUID" value={rssMeta.feed_guid} mono />}
              {rssMeta.item_guid && <DetailRow label="Item GUID" value={rssMeta.item_guid} mono />}
            </>
          )}
          {destAlias && !rssMeta?.podcast && <DetailRow label="Node Alias" value={destAlias} highlight />}
          {destPubkey && <DetailRow label="Dest Pubkey" value={destPubkey} mono />}
          <DetailRow label="Payment Hash" value={tx.payment_hash || '—'} mono />
          <DetailRow label="State" value={tx.state || '—'} />
          <DetailRow label="Amount" value={tx.amount ? `${tx.amount} msats (${msatsToSats(tx.amount)} sats)` : '—'} />
          <DetailRow label="Fees Paid" value={tx.fees_paid !== undefined ? `${tx.fees_paid} msats` : '—'} />
          <DetailRow label="Description" value={desc} />
          {tx.error_message && <DetailRow label="Error" value={tx.error_message} error />}
          <DetailRow label="Created At" value={tx.created_at ? new Date(tx.created_at * 1000).toLocaleString() : '—'} />
          {tx.preimage && <DetailRow label="Preimage" value={tx.preimage} mono />}
          {tx.invoice && <DetailRow label="Invoice" value={`${tx.invoice.slice(0, 40)}…`} mono />}
        </div>
      )}
    </>
  )
}

function DetailRow({ label, value, mono, error, highlight }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={[
        styles.detailValue,
        mono ? styles.detailMono : '',
        error ? styles.detailError : '',
        highlight ? styles.detailHighlight : '',
      ].join(' ')}>
        {value}
      </span>
    </div>
  )
}

function stateDisplay(state) {
  return {
    label: state === 'succeeded' ? '✓' : state === 'failed' ? 'FAIL' : 'PEND',
    cls: state === 'failed' ? styles.stateFail : state === 'succeeded' ? styles.stateOk : styles.statePend,
  }
}

function actionIcon(action) {
  if (action === 'boost') return '🚀'
  if (action === 'stream') return '🎵'
  return '⚡'
}

function formatPosition(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function parseV4V(metadata) {
  try {
    const tlv = metadata?.tlv_records?.find((r) => r.type === 7629169)
    if (!tlv?.value) return null
    const json = JSON.parse(
      tlv.value.replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)))
    )
    return json
  } catch {
    return null
  }
}

function parseRssPayment(description) {
  if (!description) return null
  const match = description.match(/^rss::payment::(boost|stream)\s+(https?:\/\/\S+)\s*(.*)$/)
  if (!match) return null
  return { action: match[1], url: match[2], message: match[3] || null }
}

const rssMetaCache = new Map()

function fetchRssPaymentMeta(url) {
  if (!url) return Promise.resolve(null)
  if (rssMetaCache.has(url)) return Promise.resolve(rssMetaCache.get(url))

  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })
    .then((body) => {
      let meta = null
      const trimmed = body.trim()

      // Try JSON first (e.g. Castamatic boost URLs return JSON with V4V metadata)
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const json = JSON.parse(trimmed)
          meta = {
            podcast: json.feed_title || json.podcast || null,
            episode: json.item_title || json.episode || null,
            action: json.action || null,
            sender_name: json.sender_name || null,
            app_name: json.app_name || null,
            app_version: json.app_version || null,
            recipient_name: json.recipient_name || json.name || null,
            recipient_address: json.recipient_address || null,
            message: json.message || null,
            feed_guid: json.feed_guid || null,
            item_guid: json.item_guid || null,
            position: json.position || null,
            split: json.split || null,
            value_msat: json.value_msat || null,
            value_msat_total: json.value_msat_total || null,
            feedUrl: url,
          }
        } catch { /* fall through to RSS parsing */ }
      }

      // Fall back to RSS XML parsing
      if (!meta) {
        const doc = new DOMParser().parseFromString(trimmed, 'text/xml')
        const channel = doc.querySelector('channel')
        if (channel) {
          const text = (tag) => channel.querySelector(tag)?.textContent?.trim() || null
          const itunesAuthor = channel.getElementsByTagName('itunes:author')[0]?.textContent?.trim() || null
          meta = {
            podcast: text('title'),
            episode: null,
            action: null,
            sender_name: null,
            app_name: null,
            recipient_name: itunesAuthor || text('managingEditor'),
            feedUrl: url,
          }
        }
      }

      rssMetaCache.set(url, meta)
      return meta
    })
    .catch(() => {
      rssMetaCache.set(url, null)
      return null
    })
}

function normalizeState(state) {
  const s = state?.toLowerCase() ?? ''
  if (s === 'failed') return 'failed'
  if (s === 'settled' || s === 'complete' || s === 'succeeded') return 'succeeded'
  return 'pending'
}
