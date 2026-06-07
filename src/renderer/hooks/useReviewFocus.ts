import { useEffect } from 'react';
import type { ReviewNavigationTarget } from '../services/review-navigation';

export function useReviewFocus(
  reviewTarget: ReviewNavigationTarget | undefined,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled || !reviewTarget) return;

    const timer = window.setTimeout(() => {
      const element = document.getElementById(reviewTarget.anchorId);
      if (!element) return;

      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      element.classList.add('review-focus-pulse');

      window.setTimeout(() => {
        element.classList.remove('review-focus-pulse');
      }, 2600);
    }, 160);

    return () => window.clearTimeout(timer);
  }, [enabled, reviewTarget?.anchorId, reviewTarget?.focusToken]);
}
