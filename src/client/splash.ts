/**
 * Show the page and fade out the loading screen once the first frame with
 * the page's own styles is on screen (or shortly after, in a tab that is
 * not painting frames).
 */
export function splashDone() {
  let done = false;
  const reveal = () => {
    if (done) return;
    done = true;
    document.documentElement.classList.add('gg-ready');
    const el = document.querySelector<HTMLElement>('#splash');
    if (!el) return;
    el.classList.add('gone');
    setTimeout(() => el.remove(), 400);
  };
  requestAnimationFrame(() => requestAnimationFrame(reveal));
  setTimeout(reveal, 500);
}
