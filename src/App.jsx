import { useState } from 'react'
import { useNWC } from './useNWC'
import ConnectionForm from './components/ConnectionForm'
import PaymentFeed from './components/PaymentFeed'
import styles from './App.module.css'

const POLL_INTERVAL = 5000

export default function App() {
  const { status, error, transactions, lastUpdated, connect, disconnect } = useNWC(null, POLL_INTERVAL)
  const [nwcUri, setNwcUri] = useState(null)

  const handleConnect = (uri) => {
    setNwcUri(uri)
    connect(uri)
  }

  const handleDisconnect = () => {
    disconnect()
    setNwcUri(null)
  }

  const failCount = transactions.filter((tx) => {
    const s = tx.state?.toLowerCase()
    return s === 'failed'
  }).length

  return (
    <div className={styles.app}>
      {/* Scanline effect */}
      <div className={styles.scanline} aria-hidden="true" />

      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.bolt}>⚡</span>
          <div>
            <div className={styles.title}>NWC PAYMENT MONITOR</div>
            <div className={styles.subtitle}>AlbyHub · Podcasting 2.0 · Value4Value</div>
          </div>
        </div>
        <div className={styles.headerRight}>
          {failCount > 0 && (
            <div className={styles.failAlert}>
              <span className={styles.failDot} />
              {failCount} FAIL{failCount !== 1 ? 'S' : ''}
            </div>
          )}
          <div className={styles.pollBadge}>
            POLL {POLL_INTERVAL / 1000}s
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <ConnectionForm
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          status={status}
          error={error}
        />

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>PAYMENT FEED</span>
            <span className={styles.sectionCount}>
              {transactions.length} transactions
            </span>
          </div>
          <PaymentFeed
            transactions={transactions}
            lastUpdated={lastUpdated}
            pollInterval={POLL_INTERVAL}
          />
        </section>
      </main>

      <footer className={styles.footer}>
        <span>NWC · NIP-47 · NIP-04</span>
        <span>Your key never leaves this page</span>
      </footer>
    </div>
  )
}
