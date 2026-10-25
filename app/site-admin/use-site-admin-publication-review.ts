"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicationReview } from "@/lib/shared/publication-snapshot";

export function useSiteAdminPublicationReview({ ready, read, onCountChange }: {
  ready: boolean; read: (signal: AbortSignal) => Promise<PublicationReview>; onCountChange: (count: number) => void;
}) {
  const [publicationReview, setReview] = useState<PublicationReview | null>(null);
  const [publicationReviewError, setError] = useState("");
  const [publicationReviewLoading, setLoading] = useState(false);
  const [publishReviewOpen, setPublishReviewOpen] = useState(false);
  const latest = useRef({ read, onCountChange });
  latest.current = { read, onCountChange };
  const pending = useRef<AbortController | null>(null);
  const refreshPublicationReview = useCallback(async () => {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setLoading(true); setError("");
    try {
      const review = await latest.current.read(request.signal);
      if (request.signal.aborted) return null;
      setReview(review); latest.current.onCountChange(review.changes.length);
      return review;
    } catch (error) {
      if (!request.signal.aborted) setError(error instanceof Error ? error.message : String(error));
      return null;
    } finally { if (!request.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { if (ready) void refreshPublicationReview(); }, [ready, refreshPublicationReview]);
  useEffect(() => { if (publishReviewOpen) void refreshPublicationReview(); }, [publishReviewOpen, refreshPublicationReview]);
  useEffect(() => () => pending.current?.abort(), []);
  return { publicationReview, publicationReviewError, setPublicationReviewError: setError, publicationReviewLoading, publishReviewOpen, setPublishReviewOpen, refreshPublicationReview };
}
