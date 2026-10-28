import { useEffect, useRef, useState } from 'react';
import { getReduceMotion } from '@/lib/prefs';
import reelWebm from '@/assets/media/nexmap-reel.webm';
import reelPoster from '@/assets/media/nexmap-reel-poster.jpg';
import styles from './VideoReel.module.css';

/**
 * VideoReel — the bundled hero loop (a rendered 3D network reel, local, no CDN).
 *
 * Motion policy: when reduced-motion is active we never autoplay — we show the
 * poster with a manual play affordance, and only load/play the <video> on an
 * explicit click. Otherwise it autoplays muted + looped (the only way browsers
 * allow unattended playback) and pauses when scrolled out of view / tab hidden.
 */
export function VideoReel({ className, rounded = true }: { className?: string; rounded?: boolean }) {
  const reduce = getReduceMotion() || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [playing, setPlaying] = useState(!reduce);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Pause when hidden / offscreen to save power (autoplay path only).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing) return;
    const onVis = () => {
      if (document.hidden) v.pause();
      else void v.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (e) => {
          if (e[0]?.isIntersecting) void v.play().catch(() => {});
          else v.pause();
        },
        { threshold: 0.1 },
      );
      io.observe(v);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, [playing]);

  return (
    <div className={`${styles.frame} ${rounded ? styles.rounded : ''} ${className ?? ''}`}>
      {playing ? (
        <video
          ref={videoRef}
          className={styles.video}
          src={reelWebm}
          poster={reelPoster}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-label="NexMap in motion — a 3D network constellation"
        />
      ) : (
        <button
          className={styles.posterBtn}
          onClick={() => setPlaying(true)}
          aria-label="Play the NexMap motion reel"
          style={{ backgroundImage: `url(${reelPoster})` }}
        >
          <span className={styles.playBadge}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
          </span>
        </button>
      )}
      <span className={styles.scan} aria-hidden="true" />
    </div>
  );
}
