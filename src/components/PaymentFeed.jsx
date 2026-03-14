import { useState, useMemo, useEffect } from 'react'
import { msatsToSats } from '../useNWC'
import { decodeBolt11, lookupNodeAlias, shortPubkey } from '../lightning'
import styles from './PaymentFeed.module.css'

const STATE_FILTERS = ['all', 'failed', 'succeeded', 'pending']

export default function PaymentFeed({ transactions, lastUpdated }) {
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

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

    // Group by V4V metadata: use ts when present, fall back to time-proximity clustering
    const needsClustering = new Map()
    filtered.forEach((tx) => {
      const v4v = parseV4V(tx.metadata)
      if (!v4v || !v4v.action) {
        ungrouped.push({ type: 'tx', tx })
        return
      }
      if (v4v.ts) {
        // ts present (e.g. boosts): group directly by metadata
        const key = `${v4v.action}|${v4v.podcast || ''}|${v4v.episode || ''}|${v4v.ts}`
        if (!groups.has(key)) groups.set(key, { type: 'group', key, v4v, splits: [], time: 0 })
        const group = groups.get(key)
        group.splits.push({ tx, v4v })
        group.time = Math.max(group.time, tx.created_at || 0)
      } else {
        // no ts (e.g. streams): collect for time-proximity clustering
        const contextKey = `${v4v.action}|${v4v.podcast || ''}|${v4v.episode || ''}`
        if (!needsClustering.has(contextKey)) needsClustering.set(contextKey, [])
        needsClustering.get(contextKey).push({ tx, v4v })
      }
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
  }, [filtered])

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

  const actionIcon = v4v.action === 'boost' ? '🚀' : v4v.action === 'stream' ? '🎵' : '⚡'
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
          <span className={styles.typeTag}>{actionIcon} {v4v.action?.toUpperCase() || '—'}</span>
        </div>
        <div className={`${styles.cell} ${styles.destCell} ${styles.cellDest}`}>
          <span className={styles.destAlias}>{v4v.podcast || '—'}</span>
        </div>
        <div className={`${styles.cell} ${styles.descCell} ${styles.cellDesc}`}>
          {v4v.message || v4v.episode || '—'}
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
            {v4v.app_name && <span>via {v4v.app_name}</span>}
            {v4v.episode && <span>Episode: {v4v.episode}</span>}
          </div>
          <div className={styles.splitList}>
            {splits.map((s, i) => {
              const state = normalizeState(s.tx.state)
              const stateLabel = state === 'succeeded' ? '✓' : state === 'failed' ? 'FAIL' : 'PEND'
              const stateClass = state === 'failed' ? styles.stateFail : state === 'succeeded' ? styles.stateOk : styles.statePend
              return (
                <div key={s.tx.payment_hash ?? i} className={`${styles.splitRow} ${state === 'failed' ? styles.splitRowFailed : ''}`}>
                  <span className={`${styles.stateTag} ${stateClass}`} style={{ width: '50px', textAlign: 'center' }}>{stateLabel}</span>
                  <span className={styles.splitName}>{s.v4v?.name || '—'}</span>
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

  const state = normalizeState(tx.state)
  const isFailed = state === 'failed'
  const isSuccess = state === 'succeeded'

  useEffect(() => {
    // Try V4V TLV name first
    const v4vName = parseV4VName(tx.metadata)
    if (v4vName) {
      setDestAlias(v4vName)
    }

    const pubkey = decodeBolt11(tx.invoice)
    if (pubkey) {
      setDestPubkey(pubkey)
      if (!v4vName) lookupNodeAlias(pubkey).then(setDestAlias)
    } else if (tx.metadata?.destination) {
      const ksPubkey = tx.metadata.destination
      setDestPubkey(ksPubkey)
      if (!v4vName) lookupNodeAlias(ksPubkey).then(setDestAlias)
    }
  }, [tx.invoice, tx.metadata])

  const isIncoming = tx.type === 'incoming'
  const rowClass = isFailed ? styles.rowFailed : isIncoming ? styles.rowIncoming : isSuccess ? styles.rowSuccess : styles.rowPending
  const stateLabel = isSuccess ? '✓' : isFailed ? 'FAIL' : 'PEND'
  const stateClass = isFailed ? styles.stateFail : isSuccess ? styles.stateOk : styles.statePend

  const rssPayment = parseRssPayment(tx.description || tx.memo)
  const desc = rssPayment?.message || tx.description || tx.memo || '—'
  const time = tx.created_at ? new Date(tx.created_at * 1000).toLocaleTimeString() : '—'
  const destDisplay = destAlias ?? (destPubkey ? shortPubkey(destPubkey) : null)

  const typeLabel = rssPayment
    ? `${rssPayment.action === 'boost' ? '🚀' : '🎵'} ${rssPayment.action.toUpperCase()}`
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
          ) : tx.type === 'outgoing' ? (
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
          {destAlias && <DetailRow label="Node Alias" value={destAlias} highlight />}
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

function parseV4VName(metadata) {
  const v4v = parseV4V(metadata)
  return v4v?.name || null
}

function parseRssPayment(description) {
  if (!description) return null
  const match = description.match(/^rss::payment::(boost|stream)\s+(https?:\/\/\S+)\s*(.*)$/)
  if (!match) return null
  return { action: match[1], url: match[2], message: match[3] || null }
}

function normalizeState(state) {
  const s = state?.toLowerCase() ?? ''
  if (s === 'failed') return 'failed'
  if (s === 'settled' || s === 'complete' || s === 'succeeded') return 'succeeded'
  return 'pending'
}
