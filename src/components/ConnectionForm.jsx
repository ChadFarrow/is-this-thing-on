import { useState } from 'react'
import styles from './ConnectionForm.module.css'

export default function ConnectionForm({ onConnect, onDisconnect, status, error }) {
  const [uri, setUri] = useState('')
  const [showUri, setShowUri] = useState(false)
  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting'

  const handleSubmit = (e) => {
    e.preventDefault()
    if (uri.trim()) onConnect(uri.trim())
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.label}>NWC CONNECTION</span>
        <StatusDot status={status} />
      </div>

      {!isConnected ? (
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.inputWrapper}>
            <input
              type={showUri ? 'text' : 'password'}
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="nostr+walletconnect://..."
              className={styles.input}
              disabled={isConnecting}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className={styles.toggleBtn}
              onClick={() => setShowUri(!showUri)}
              tabIndex={-1}
            >
              {showUri ? '🙈' : '👁'}
            </button>
          </div>
          {error && <div className={styles.error}>⚠ {error}</div>}
          <button
            type="submit"
            className={styles.connectBtn}
            disabled={isConnecting || !uri.trim()}
          >
            {isConnecting ? (
              <><span className={styles.spinner} /> CONNECTING...</>
            ) : (
              '⚡ CONNECT'
            )}
          </button>
          <p className={styles.hint}>
            Your NWC string stays in your browser and is never transmitted anywhere except your own relay.
          </p>
        </form>
      ) : (
        <div className={styles.connectedRow}>
          <span className={styles.connectedText}>Connected to AlbyHub</span>
          <button className={styles.disconnectBtn} onClick={onDisconnect}>
            DISCONNECT
          </button>
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }) {
  const map = {
    disconnected: { color: '#3a3a55', label: 'OFFLINE' },
    connecting: { color: '#f7931a', label: 'CONNECTING', pulse: true },
    connected: { color: '#00e5a0', label: 'LIVE', pulse: true },
    error: { color: '#ff4466', label: 'ERROR' },
  }
  const s = map[status] || map.disconnected
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: s.color,
        animation: s.pulse ? 'pulse 2s ease-in-out infinite' : 'none',
        boxShadow: s.pulse ? `0 0 6px ${s.color}` : 'none',
      }} />
      <span style={{ color: s.color, fontSize: '11px', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>
        {s.label}
      </span>
    </div>
  )
}
