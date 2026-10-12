import { useState } from 'react'
import { installedOnThisPhone } from '../auth/howTo'

/** First-run guide, and the same screen again from Account. */
export function HowTo({ onDone }: { onDone: () => void }) {
  const [installed] = useState(() => installedOnThisPhone())

  return (
    <div className="how-to">
      <ol className="how-to__steps">
        {!installed && (
          <li>
            <p>
              <strong>Save it on your home screen.</strong> Then it opens like any other app, and you can record orders
              with no connection.
            </p>
            <p>
              On Android, open the browser menu and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            </p>
            <p>
              On iPhone, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
            </p>
          </li>
        )}
        <li>
          <p>
            Tap <strong>New order</strong>. Write the customer, what they bought, and the amount.
          </p>
        </li>
        <li>
          <p>Open the order to record a payment when money arrives, then mark it dispatched and delivered.</p>
        </li>
        <li>
          <p>
            <strong>Dashboard</strong> shows what you received. Choose the days, then tap <strong>Download sales Report</strong>.
          </p>
        </li>
      </ol>
      <button type="button" className="button button--primary" onClick={onDone}>
        Got it
      </button>
    </div>
  )
}
