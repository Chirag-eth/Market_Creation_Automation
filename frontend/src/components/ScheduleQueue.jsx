import { useState } from 'react'
import DateTimePicker from './DateTimePicker.jsx'

function fmtScheduled(dtLocal) {
  const d = new Date(dtLocal)
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })
    + '  ·  '
    + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function timeUntil(dtLocal) {
  const diff = new Date(dtLocal).getTime() - Date.now()
  if (diff <= 0) return 'overdue'
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (days > 0)  return `in ${days}d ${hours % 24}h`
  if (hours > 0) return `in ${hours}h ${mins % 60}m`
  return `in ${mins}m`
}

function urgencyClass(dtLocal) {
  const diff = new Date(dtLocal).getTime() - Date.now()
  if (diff <= 0)          return 'queue-job--overdue'
  if (diff < 3_600_000)   return 'queue-job--urgent'   // < 1 h
  if (diff < 86_400_000)  return 'queue-job--soon'      // < 24 h
  return ''
}

function fixtureNames(fixtures) {
  if (fixtures.length <= 2) return fixtures.map(f => `${f.home} vs ${f.away}`).join(', ')
  return `${fixtures[0].home} vs ${fixtures[0].away}, ${fixtures[1].home} vs ${fixtures[1].away} +${fixtures.length - 2} more`
}

function jobMarkets(job) {
  const seen = new Set(), result = []
  job.fixtures.forEach(f => {
    (f.customSubmarkets ?? []).forEach(m => {
      if (!seen.has(m.id)) { seen.add(m.id); result.push(m) }
    })
  })
  return result
}

export default function ScheduleQueue({ jobs, onCancel, onEditTime, onClearCancelled, onClose }) {
  const [editJobId,  setEditJobId]  = useState(null)
  const [editTime,   setEditTime]   = useState('')

  const pending   = jobs.filter(j => j.status === 'pending')
  const cancelled = jobs.filter(j => j.status === 'cancelled')
  const editJob   = jobs.find(j => j.id === editJobId)

  return (
    <div className="review queue-overlay">
      <div className="review__hdr">
        <button className="btn-back" onClick={onClose}>← Close</button>
        <div className="review__title">Scheduled Queue</div>
        {pending.length > 0 && <div className="queue-badge">{pending.length} pending</div>}
        <div style={{ flex: 1 }} />
        {cancelled.length > 0 && (
          <button className="btn-ghost" onClick={onClearCancelled}>
            Clear cancelled ({cancelled.length})
          </button>
        )}
      </div>

      <div className="review__body">
        <div className="review__inner">
          {jobs.length === 0 ? (
            <div className="queue-empty">
              <div className="queue-empty__icon">⏱</div>
              <div className="queue-empty__title">No scheduled jobs</div>
              <div className="queue-empty__sub">
                Use "Schedule for later" in the review step to queue a publish batch.
              </div>
            </div>
          ) : (
            jobs.map(job => {
              const markets = jobMarkets(job)
              return (
                <div
                  key={job.id}
                  className={`queue-job ${job.status === 'pending' ? urgencyClass(job.scheduledAt) : 'queue-job--cancelled'}`}
                >
                  <div className="queue-job__main">
                    <div className="queue-job__fixtures">{fixtureNames(job.fixtures)}</div>
                    <div className="queue-job__meta">
                      {job.totalMarkets} markets
                      <span className="queue-job__sep">·</span>
                      {job.fixtures.length} fixture{job.fixtures.length !== 1 ? 's' : ''}
                    </div>
                    <div className="queue-job__mkts">
                      {markets.map(m => (
                        <span key={m.id} className="mkt-tag mkt-tag--sm">{m.label}</span>
                      ))}
                    </div>
                  </div>
                  <div className="queue-job__right">
                    <div className="queue-job__time">{fmtScheduled(job.scheduledAt)}</div>
                    {job.status === 'pending' && (
                      <div className={`queue-job__until${urgencyClass(job.scheduledAt) ? ' queue-job__until--urgent' : ''}`}>
                        {timeUntil(job.scheduledAt)}
                      </div>
                    )}
                    {job.status === 'pending' ? (
                      <div className="queue-job__actions">
                        <button
                          className="queue-job__edit"
                          onClick={() => { setEditJobId(job.id); setEditTime(job.scheduledAt) }}
                        >
                          Edit time
                        </button>
                        <button className="queue-job__cancel" onClick={() => onCancel(job.id)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="queue-job__cancelled-label">Cancelled</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Edit time modal */}
      {editJobId && (
        <div className="sched-backdrop" onClick={() => setEditJobId(null)}>
          <div className="sched-modal" onClick={e => e.stopPropagation()}>
            <div className="sched-modal__hdr">
              <div className="sched-modal__title">Reschedule</div>
              <div className="sched-modal__sub">
                {editJob ? fixtureNames(editJob.fixtures) : ''}
              </div>
            </div>
            <DateTimePicker initValue={editJob?.scheduledAt} onChange={setEditTime} />
            <div className="sched-modal__ftr">
              <button className="btn-ghost" onClick={() => setEditJobId(null)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={!editTime}
                onClick={() => { onEditTime(editJobId, editTime); setEditJobId(null) }}
              >
                Save
                <span className="btn-primary__arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
