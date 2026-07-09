"use client";

import { forwardRef } from "react";
import Composer from "./Composer";
import EmptyState from "./EmptyState";
import MessageBubble from "./MessageBubble";
import type { Message, Phase } from "./types";

interface Props {
  messages: Message[];
  loading: boolean;
  phase: Phase | null;
  input: string;
  setInput: (v: string) => void;
  onSubmit: (q?: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

const ChatColumn = forwardRef<HTMLDivElement, Props>(function ChatColumn(
  { messages, loading, phase, input, setInput, onSubmit, messagesEndRef },
  topRef,
) {
  return (
    <div ref={topRef} className="flex flex-col">
      {messages.length === 0 ? (
        <EmptyState onPick={(q) => onSubmit(q)} loading={loading} />
      ) : (
        <div className="space-y-4">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              loading={loading}
              phase={phase}
            />
          ))}
          {/* Anchor for auto-scroll. scroll-mb keeps the new message visible
              above the sticky composer instead of pinned beneath it. */}
          <div ref={messagesEndRef} className="scroll-mb-32" />
        </div>
      )}

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => onSubmit()}
        loading={loading}
      />
    </div>
  );
});

export default ChatColumn;
