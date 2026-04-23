import React from "react";
import type { DirectiveDescriptor } from "@mdxeditor/editor";
import { VoiceMemoAudioSection } from "./VoiceMemoAudioSection";

/**
 * Renders one `VoiceMemoAudioSection` per `::voice_memo_recording{path="..."}` leaf directive (markdown persisted by Rust on each capture).
 */
export const VoiceMemoRecordingDirectiveDescriptor: DirectiveDescriptor = {
  name: "voice_memo_recording",
  type: "leafDirective",
  attributes: ["path"],
  hasChildren: false,
  testNode(node) {
    return node.type === "leafDirective" && node.name === "voice_memo_recording";
  },
  Editor({ mdastNode }) {
    const path = mdastNode.attributes?.path?.trim() ?? "";
    const clipKey = path || "empty";
    return (
      <VoiceMemoAudioSection noteId={clipKey} audioFilePath={path || null} />
    );
  },
};
