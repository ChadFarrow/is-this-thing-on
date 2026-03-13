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
      const matchState =
        filter === 'all' ||
        (filter === 'failed' && s === 'failed') ||
        (filter === 'succeeded' && s === 'succeeded') ||
        (filter === 'pending' && s === 'pending')
      const matchType =
        typeFilter === 'all' ||
        (typeFilter === 'outgoing' && tx.type === 'outgoing') ||
        (typeFilter === 'incoming' && tx.type === 'incoming')
      return matchState && matchType
    })
  }, [transactions, filter, typeFilter])

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
          <div className={styles.col} style={{ width: '70px' }}>STATE</div>
          <div className={styles.col} style={{ width: '60px' }}>TYPE</div>
          <div className={styles.col} style={{ flex: 1, minWidth: 0 }}>DESTINATION</div>
          <div className={styles.col} style={{ flex: 1, minWidth: 0 }}>DESCRIPTION</div>
          <div className={styles.col} style={{ width: '90px', textAlign: 'right' }}>AMOUNT</div>
          <div className={styles.col} style={{ width: '70px', textAlign: 'right' }}>FEES</div>
          <div className={styles.col} style={{ width: '130px', textAlign: 'right' }}>TIME</div>
        </div>
        <div className={styles.tbody}>
          {filtered.length === 0 ? (
            <div className={styles.noResults}>No transactions match this filter.</div>
          ) : (
            filtered.map((tx, i) => (
              <TransactionRow key={tx.payment_hash ?? i} tx={tx} />
            ))
          )}
        </div>
      </div>
    </div>
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
    const pubkey = decodeBolt11(tx.invoice)
    if (pubkey) {
      setDestPubkey(pubkey)
      lookupNodeAlias(pubkey).then(setDestAlias)
    } else if (tx.metadata?.destination) {
      const ksPubkey = tx.metadata.destination
      setDestPubkey(ksPubkey)
      lookupNodeAlias(ksPubkey).then(setDestAlias)
    }
  }, [tx.invoice, tx.metadata])

  const rowClass = isFailed ? styles.rowFailed : isSuccess ? styles.rowSuccess : styles.rowPending
  const stateLabel = isSuccess ? '✓' : isFailed ? 'FAIL' : 'PEND'
  const stateClass = isFailed ? styles.stateFail : isSuccess ? styles.stateOk : styles.statePend

  const desc = tx.description || tx.memo || '—'
  const time = tx.created_at ? new Date(tx.created_at * 1000).toLocaleTimeString() : '—'
  const destDisplay = destAlias ?? (destPubkey ? shortPubkey(destPubkey) : null)

  return (
    <>
      <div className={`${styles.row} ${rowClass}`} onClick={() => setExpanded(!expanded)}>
        <div className={styles.cell} style={{ width: '70px' }}>
          <span className={`${styles.stateTag} ${stateClass}`}>{stateLabel}</span>
        </div>
        <div className={styles.cell} style={{ width: '60px' }}>
          <span className={styles.typeTag}>{tx.type === 'outgoing' ? '↑ OUT' : '↓ IN'}</span>
        </div>
        <div className={`${styles.cell} ${styles.destCell}`} style={{ flex: 1, minWidth: 0 }}>
          {destDisplay ? (
            <span className={styles.destAlias} title={destPubkey}>{destDisplay}</span>
          ) : tx.type === 'outgoing' ? (
            <span className={styles.destUnknown}>decoding…</span>
          ) : (
            <span className={styles.destUnknown}>—</span>
          )}
        </div>
        <div className={`${styles.cell} ${styles.descCell}`} style={{ flex: 1, minWidth: 0 }}>
          {desc}
        </div>
        <div className={styles.cell} style={{ width: '90px', textAlign: 'right' }}>
          <span className={styles.amount}>{msatsToSats(tx.amount)} <span className={styles.unit}>sats</span></span>
        </div>
        <div className={styles.cell} style={{ width: '70px', textAlign: 'right', color: 'var(--text-dim)' }}>
          {tx.fees_paid !== undefined ? msatsToSats(tx.fees_paid) : '—'}
        </div>
        <div className={styles.cell} style={{ width: '130px', textAlign: 'right', color: 'var(--text-dim)', fontSize: '11px' }}>
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

function normalizeState(state) {
  const s = state?.toLowerCase() ?? ''
  if (s === 'failed') return 'failed'
  if (s === 'settled' || s === 'complete' || s === 'succeeded') return 'succeeded'
  return 'pending'
}
