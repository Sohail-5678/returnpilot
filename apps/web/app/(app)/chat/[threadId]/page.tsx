import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatView } from "@/components/chat/chat-view";

export const metadata: Metadata = { title: "Chat" };

export default async function ThreadPage(props: PageProps<"/chat/[threadId]">) {
  const { threadId } = await props.params;
  return (
    <Suspense>
      <ChatView key={threadId} initialThreadId={threadId} />
    </Suspense>
  );
}
