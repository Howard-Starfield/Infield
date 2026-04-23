import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioPlayer } from "@/components/ui/AudioPlayer";
import { localAudioFilePathToUrl } from "@/lib/localAudioFileUrl";

interface VoiceMemoAudioSectionProps {
  noteId: string;
  audioFilePath: string | null;
}

/**
 * Inline recording preview below the transcript (voice_memo notes only).
 */
export const VoiceMemoAudioSection: React.FC<VoiceMemoAudioSectionProps> = ({
  noteId,
  audioFilePath,
}) => {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const revokeBlobRef = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };

    revokeBlobRef();
    setSrc(null);

    if (!audioFilePath?.trim()) {
      return () => {
        cancelled = true;
        revokeBlobRef();
      };
    }

    void (async () => {
      const url = await localAudioFilePathToUrl(audioFilePath);
      if (cancelled) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        return;
      }
      if (url?.startsWith("blob:")) blobUrlRef.current = url;
      setSrc(url);
    })();

    return () => {
      cancelled = true;
      revokeBlobRef();
      setSrc(null);
    };
  }, [noteId, audioFilePath]);

  if (!audioFilePath) {
    return (
      <div
        style={{
          marginTop: 28,
          paddingTop: 20,
          borderTop: "1px solid var(--workspace-border)",
          fontSize: 12,
          color: "var(--workspace-text-muted)",
          lineHeight: 1.5,
        }}
      >
        {t("notes.voiceMemo.noAudioFile")}
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 28,
        paddingTop: 20,
        borderTop: "1px solid var(--workspace-border)",
      }}
    >
      <div
        className="workspace-eyebrow"
        style={{
          marginBottom: 10,
          letterSpacing: "0.06em",
          fontSize: 10,
          color: "var(--workspace-text-muted)",
        }}
      >
        {t("notes.voiceMemo.recordingHeading")}
      </div>
      {src ? (
        <AudioPlayer src={src} className="w-full max-w-xl" />
      ) : (
        <div style={{ fontSize: 12, color: "var(--workspace-text-muted)" }}>
          {t("notes.voiceMemo.audioLoadFailed")}
        </div>
      )}
    </div>
  );
};
