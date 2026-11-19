import type { ChatOutbox, OutboxMessage } from './useChatOutbox'
import { formatChatTime } from './chatTime'
import { MessageReceipt } from './MessageReceipt'

export function PendingChatMessages({ items, outbox }: { items: OutboxMessage[]; outbox: ChatOutbox }) {
  return <>{items.map((item) => <article className="companion-message-row" key={item.id}>
    <div className="companion-message-content">
      {item.replyTo && <div className="companion-reply-quote"><strong>Replying to {item.replyTo.isMine ? 'yourself' : 'a message'}</strong><span>{item.replyTo.text}</span></div>}
      <div className="companion-message-meta"><strong>You</strong><time dateTime={item.createdAt}>{formatChatTime(item.createdAt)}</time>
        {item.status === 'sending' ? <MessageReceipt status="sending" />
          : item.status === 'sent' ? <MessageReceipt status="sent" />
          : <span className="companion-send-failed" role="alert">{item.deliveryUnconfirmed ? 'Not confirmed' : 'Not sent'}</span>}
      </div>
      <p className="companion-message-text">{item.text}</p>
      {item.status === 'failed' && <div className="companion-send-error">
        <span>{item.error}</span>
        <button type="button" onClick={() => void outbox.retry(item)}>Retry</button>
        <button type="button" onClick={() => outbox.discard(item.id)}>Discard</button>
      </div>}
    </div>
  </article>)}</>
}
