import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatView } from "@/components/chat/chat-view";

export const metadata: Metadata = { title: "Chat" };

export default function NewChatPage() {
  return (
    <Suspense>
      <ChatView initialThreadId={null} />
    </Suspense>
  );
}
