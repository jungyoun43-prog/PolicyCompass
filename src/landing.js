const revealTargets = [...document.querySelectorAll("[data-reveal]")];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (revealTargets.length && !reduceMotion) {
  const visibleEdge = window.innerHeight * 0.92;

  for (const target of revealTargets) {
    if (target.getBoundingClientRect().top < visibleEdge) {
      target.classList.add("is-revealed");
    }
  }

  document.documentElement.classList.add("reveal-ready");

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-revealed");
      observer.unobserve(entry.target);
    }
  }, {
    rootMargin: "0px 0px -12% 0px",
    threshold: 0.08,
  });

  for (const target of revealTargets) {
    if (!target.classList.contains("is-revealed")) observer.observe(target);
  }
}
